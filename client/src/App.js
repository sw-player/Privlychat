// client/src/App.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import sodium from 'libsodium-wrappers';

import { generateCryptoBoxKeyPair, registerPublicKey, fetchPublicKey } from './crypto/crypto_box_keys';
import { encryptMessage, decryptMessage } from './crypto/crypto_box_message';

const WEBSOCKET_URL = process.env.REACT_APP_WEBSOCKET_URL || 'ws://localhost:8080';
const USER_IDS = ['alice_ws', 'bob_ws', 'charlie_ws'];
const LOCAL_STORAGE_KEY_PREFIX = 'privlychat_userkeys_';
const LOCAL_STORAGE_MESSAGES_PREFIX = 'privlychat_messages_';

const getConversationKey = (userId1, userId2) => {
  const sortedIds = [userId1, userId2].sort();
  return `${LOCAL_STORAGE_MESSAGES_PREFIX}${sortedIds[0]}_${sortedIds[1]}`;
};

export default function App() {
  const [currentUserId, setCurrentUserId] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [ws, setWs] = useState(null);
  const [serverInfo, setServerInfo] = useState('사용자를 선택해주세요.');
  const [errorInfo, setErrorInfo] = useState('');
  const [isSodiumReady, setIsSodiumReady] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState({});

  const currentUserKeysRef = useRef(null);
  const messagesEndRef = useRef(null);
  // StrictMode에서 특정 userId에 대한 초기화 *시도*가 이미 있었는지 추적
  const initializationAttemptedForUser = useRef(new Set());

  useEffect(() => {
    const initSodium = async () => {
      if (isSodiumReady) return;
      await sodium.ready;
      setIsSodiumReady(true);
      console.log("Sodium 라이브러리 로드 완료.");
    };
    initSodium();
  }, [isSodiumReady]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // handleIncomingMessage는 currentUserId에만 의존하도록 수정 (나머지는 안정적)
  const handleIncomingMessage = useCallback(async (senderId, payload, isCurrentChatActive) => {
    if (!currentUserKeysRef.current?.privateKey) {
      console.error(`[${currentUserId} RECV] 나의 개인키(ref)가 없습니다. 복호화 불가.`);
      setErrorInfo('개인키(ref)가 없어 메시지를 복호화할 수 없습니다.');
      return;
    }
    try {
      const senderPublicKeyB64 = await fetchPublicKey(senderId);
      if (!senderPublicKeyB64) throw new Error(`${senderId} 공개키 없음`);
      const decryptedText = await decryptMessage(
        payload.ciphertextB64, payload.nonceB64,
        senderPublicKeyB64, currentUserKeysRef.current.privateKey
      );
      const newMessage = { sender: senderId, text: decryptedText, type: 'received', timestamp: new Date() };
      
      const conversationKeyForStorage = getConversationKey(currentUserId, senderId);
      const storedMessagesString = localStorage.getItem(conversationKeyForStorage);
      let currentConversationMessages = [];
      if (storedMessagesString) {
        try { currentConversationMessages = JSON.parse(storedMessagesString); }
        catch (e) { console.error(`메시지 저장 중 ${conversationKeyForStorage} 파싱 오류:`, e); }
      }
      currentConversationMessages.push(newMessage);
      localStorage.setItem(conversationKeyForStorage, JSON.stringify(currentConversationMessages));

      if (isCurrentChatActive) {
        setMessages(prev => [...prev, newMessage]);
      } else {
        console.log(`${senderId}로부터 온 새 메시지를 백그라운드에 저장 및 알림 처리됨.`);
      }
    } catch (error) {
      console.error(`[${currentUserId} RECV] 메시지 복호화 오류:`, error);
      setErrorInfo(`메시지 복호화 실패: ${error.message}`);
      if (isCurrentChatActive) {
        setMessages(prev => [...prev, { sender: senderId, text: `(암호문 복호화 실패)`, type: 'received-error', timestamp: new Date() }]);
      }
    }
  }, [currentUserId]); // 의존성에서 set 함수들 제거 (안정적이라고 간주)

  useEffect(() => {
    if (!isSodiumReady) {
      console.log(`[Effect ${currentUserId || 'NoUser'}] Sodium 아직 준비 안됨, 대기.`);
      return;
    }

    if (!currentUserId) {
      console.log(`[Effect NoUser] currentUserId가 선택되지 않았습니다. 정리합니다.`);
      setServerInfo('먼저 사용자를 선택해주세요.');
      if (ws) { console.log("[Effect NoUser] 이전 ws 연결 닫기."); ws.close(); setWs(null); }
      currentUserKeysRef.current = null;
      setMessages([]);
      setRecipientId('');
      initializationAttemptedForUser.current.clear(); // 모든 사용자 초기화 시도 상태 해제
      return;
    }

    // StrictMode 이중 실행 방지: 현재 사용자에 대한 설정 작업이 이미 "시도"되었다면 건너뜀.
    // 이 플래그는 이 useEffect가 특정 currentUserId로 처음 실행될 때 설정됨.
    if (process.env.NODE_ENV === 'development' && initializationAttemptedForUser.current.has(currentUserId)) {
      console.log(`[Effect ${currentUserId}] StrictMode: 이미 이 사용자(${currentUserId})로 초기화 시도됨. 건너뜁니다.`);
      // 만약 ws 연결이 끊어졌다면 여기서 재연결 로직을 넣을 수 있지만,
      // onclose 핸들러에서 initializationAttemptedForUser를 delete하면 자연스럽게 재시도됨.
      return;
    }

    console.log(`[Effect ${currentUserId}] 사용자 초기화 및 WebSocket 연결 시작...`);
    setMessages([]);
    setErrorInfo('');
    setServerInfo(`'${currentUserId.replace('_ws','')}' 사용자 초기화 중...`);

    // 이전 WebSocket 연결이 있다면 명시적으로 정리 (상태가 아직 이전 사용자 것일 수 있으므로)
    if (ws) {
      console.log(`[Effect ${currentUserId}] 이전 WebSocket 연결 (URL: ${ws.url}) 닫는 중...`);
      ws.close();
      setWs(null); // 상태를 null로 설정하여 이전 연결 객체 참조 제거
    }
    currentUserKeysRef.current = null; // 이전 사용자 키 정보 초기화

    // StrictMode 이중 실행 방지를 위해, 실제 초기화 로직 실행 전에 플래그 설정
    if (process.env.NODE_ENV === 'development') {
      initializationAttemptedForUser.current.add(currentUserId);
    }

    const initializeUser = async () => {
      try {
        let keys;
        const localStorageKey = `${LOCAL_STORAGE_KEY_PREFIX}${currentUserId}`;
        const storedKeysString = localStorage.getItem(localStorageKey);

        if (storedKeysString) {
          try {
            keys = JSON.parse(storedKeysString);
            if (!keys || !keys.publicKey || !keys.privateKey) throw new Error('Invalid stored key format');
            console.log(`[${currentUserId}] localStorage에서 키 로드 성공. 공개키: ${keys.publicKey.slice(0,10)}...`);
          } catch (e) {
            console.warn(`[${currentUserId}] localStorage 키 파싱/유효성 오류. 새 키 생성. 오류:`, e);
            localStorage.removeItem(localStorageKey); keys = null;
          }
        }

        if (!keys) {
          console.log(`[${currentUserId}] 새 키 쌍 생성 중...`);
          keys = await generateCryptoBoxKeyPair();
          localStorage.setItem(localStorageKey, JSON.stringify(keys));
          console.log(`[${currentUserId}] 새 키 생성 및 localStorage 저장 완료. 공개키: ${keys.publicKey.slice(0,10)}...`);
          // 새 키를 생성했으므로 서버에 등록
          await registerPublicKey(currentUserId, keys.publicKey);
          console.log(`[${currentUserId}]의 새 공개키 서버 등록 완료.`);
        } else {
          // localStorage에 키가 있더라도, 서버가 재시작되었을 수 있으므로 현재 키를 서버에 알림
          console.log(`[${currentUserId}] localStorage 키 사용. 서버에 공개키 (재)등록 시도...`);
          await registerPublicKey(currentUserId, keys.publicKey);
          console.log(`[${currentUserId}]의 공개키 서버 등록/갱신 완료.`);
        }
        currentUserKeysRef.current = keys;

        console.log(`[${currentUserId}] WebSocket 서버 연결 시도... (${WEBSOCKET_URL}?userId=${currentUserId})`);
        const newWs = new WebSocket(`${WEBSOCKET_URL}?userId=${currentUserId}`);

        newWs.onopen = () => {
          console.log(`[WS ${currentUserId}] 서버에 연결됨.`);
          setServerInfo(`'${currentUserId.replace('_ws','')}' 사용자로 서버에 연결되었습니다.`);
          setWs(newWs); // 연결 성공 후 ws 상태 업데이트
        };
        newWs.onmessage = (event) => {
          try {
            const receivedMsg = JSON.parse(event.data);
            // console.log(`[WS ${currentUserId}] 메시지 수신:`, receivedMsg); // 로그가 너무 많으면 주석 처리
            if (receivedMsg.type === 'message' && receivedMsg.senderId && receivedMsg.payload) {
              const isCurrentChatActive = receivedMsg.senderId === recipientId;
              if (!isCurrentChatActive) {
                setUnreadCounts(prevCounts => ({
                  ...prevCounts,
                  [receivedMsg.senderId]: (prevCounts[receivedMsg.senderId] || 0) + 1,
                }));
              }
              handleIncomingMessage(receivedMsg.senderId, receivedMsg.payload, isCurrentChatActive);
            } else if (receivedMsg.type === 'info') { setServerInfo(receivedMsg.message);
            } else if (receivedMsg.type === 'error') { setErrorInfo(`서버 오류: ${receivedMsg.message}`); }
          } catch (e) { console.error('수신 메시지 파싱 오류:', e); setErrorInfo('수신 메시지 처리 중 오류.'); }
        };
        newWs.onclose = (event) => {
          console.log(`[WS ${currentUserId}] 서버와 연결 끊김. Code: ${event.code}, Reason: ${event.reason}`);
          setServerInfo('서버와 연결이 끊어졌습니다.');
          // 현재 활성 ws와 같을 때만 null로 설정하고, 초기화 시도 상태 해제
          setWs(prevWs => {
            if (prevWs === newWs) {
              if (process.env.NODE_ENV === 'development') {
                initializationAttemptedForUser.current.delete(currentUserId);
              }
              return null;
            }
            return prevWs;
          });
        };
        newWs.onerror = (error) => {
          console.error(`[WS ${currentUserId}] WebSocket 오류:`, error);
          setErrorInfo('WebSocket 연결 오류.');
          setWs(prevWs => {
            if (prevWs === newWs) {
              if (process.env.NODE_ENV === 'development') {
                initializationAttemptedForUser.current.delete(currentUserId);
              }
              return null;
            }
            return prevWs;
          });
        };
      } catch (err) {
        console.error(`[${currentUserId}] 사용자 초기화 중 심각한 오류:`, err);
        setErrorInfo(`초기화 오류: ${err.message}`);
        setWs(null); currentUserKeysRef.current = null;
        if (process.env.NODE_ENV === 'development') {
          initializationAttemptedForUser.current.delete(currentUserId);
        }
      }
    };

    initializeUser();

    return () => {
      console.log(`useEffect 클린업 (currentUserId: ${currentUserId}). 현재 ws 상태: ${ws ? ws.readyState : 'null'}`);
      // 이 cleanup 함수는 currentUserId가 변경되거나 컴포넌트가 언마운트될 때 호출됩니다.
      // StrictMode의 첫 번째 "unmount" 시에도 호출됩니다.
      // 여기서 ws를 닫고, 다음 effect 실행 시 새 연결을 만듭니다.
      if (ws) {
        console.log(`[클린업 ${currentUserId}] WebSocket 연결 닫는 중 (URL: ${ws.url}).`);
        ws.close();
        // setWs(null); // 여기서 setWs(null)을 하면 다음 사용자 초기화 시 이전 ws가 남아있을 수 있는 문제 방지
      }
      // StrictMode의 첫 번째 unmount 시, 다음 mount에서 다시 initializeUser가 실행되도록
      // effectRanForUser에서 현재 ID를 제거하지 *않습니다*. 상단의 가드가 이를 처리합니다.
      // 사용자가 명시적으로 변경될 때만 effectRanForUser에서 이전 ID를 제거하는 것이 더 나을 수 있습니다 (handleUserChange에서).
      // 하지만 현재는 currentUserId 변경 시 effect가 다시 돌고, 그 안에서 effectRanForUser.has 체크를 하므로 괜찮습니다.
    };
  // 의존성 배열: handleIncomingMessage는 useCallback으로 안정화, recipientId와 unreadCounts는 onmessage 내부 로직에 영향
  }, [currentUserId, isSodiumReady, recipientId, handleIncomingMessage, unreadCounts, ws]);

  // recipientId 또는 currentUserId가 변경될 때 메시지 로드 및 읽음 처리
  useEffect(() => {
    if (recipientId && currentUserId && isSodiumReady) {
      console.log(`채팅 상대 또는 현재 사용자 변경: ${currentUserId} <-> ${recipientId}. 메시지 로드 및 읽음 처리.`);
      const conversationKey = getConversationKey(currentUserId, recipientId);
      const storedMessagesString = localStorage.getItem(conversationKey);
      if (storedMessagesString) {
        try {
          const loadedMessages = JSON.parse(storedMessagesString);
          const messagesWithDateObjects = loadedMessages.map(msg => ({ ...msg, timestamp: new Date(msg.timestamp) }));
          setMessages(messagesWithDateObjects);
        } catch (e) { console.error(`${conversationKey} 메시지 파싱 오류:`, e); setMessages([]); }
      } else {
        setMessages([]);
      }
      setMessageInput('');
      if (unreadCounts[recipientId] && unreadCounts[recipientId] > 0) {
        console.log(`[Unread] ${recipientId} 채팅방 열림. 읽지 않은 메시지 ${unreadCounts[recipientId]}개 초기화.`);
        setUnreadCounts(prevCounts => ({
          ...prevCounts,
          [recipientId]: 0,
        }));
      }
    } else if (!recipientId && currentUserId) {
        setMessages([]);
    }
  }, [recipientId, currentUserId, isSodiumReady, unreadCounts]); // unreadCounts도 의존성에 추가

  // ... (saveMessageToLocalStorage, handleSendMessage, handleUserChange, handleRecipientSelect, formatTimestamp 및 JSX는 이전과 동일) ...
  const saveMessageToLocalStorage = (newMessage, convKeyUserId1, convKeyUserId2) => {
    if (!convKeyUserId1 || !convKeyUserId2) return;
    const conversationKey = getConversationKey(convKeyUserId1, convKeyUserId2);
    const storedMessagesString = localStorage.getItem(conversationKey);
    let currentConversationMessages = [];
    if (storedMessagesString) {
      try { currentConversationMessages = JSON.parse(storedMessagesString); }
      catch (e) { console.error(`메시지 저장 중 ${conversationKey} 파싱 오류:`, e); }
    }
    currentConversationMessages.push(newMessage);
    localStorage.setItem(conversationKey, JSON.stringify(currentConversationMessages));
  };

  const handleSendMessage = async () => {
    if (!currentUserId || !messageInput.trim() || !ws || ws.readyState !== WebSocket.OPEN || !currentUserKeysRef.current?.privateKey || !recipientId) {
      setErrorInfo('메시지 전송 불가 조건 확인'); return;
    }
    setErrorInfo('');
    try {
      const recipientPublicKeyB64 = await fetchPublicKey(recipientId);
      if (!recipientPublicKeyB64) throw new Error(`${recipientId} 공개키 없음`);
      const encryptedPayload = await encryptMessage(messageInput, recipientPublicKeyB64, currentUserKeysRef.current.privateKey);
      const messageToSend = { type: 'message', recipientId: recipientId, payload: encryptedPayload };
      ws.send(JSON.stringify(messageToSend));
      const newMessage = { sender: currentUserId, text: messageInput, type: 'sent', timestamp: new Date() };
      saveMessageToLocalStorage(newMessage, currentUserId, recipientId);
      setMessages(prev => [...prev, newMessage]);
      setMessageInput('');
    } catch (error) {
      console.error(`[${currentUserId} SEND] 메시지 전송 오류:`, error);
      setErrorInfo(`메시지 전송 실패: ${error.message}`);
    }
  };

  const handleUserChange = (event) => {
    const newUserId = event.target.value;
    console.log(`사용자 선택 변경 시도: ${currentUserId} -> ${newUserId}`);
    if (newUserId !== currentUserId) {
      // StrictMode 이중 실행 방지를 위해, 이전 사용자의 "초기화 시도됨" 상태를 여기서 지워줍니다.
      // 이렇게 하면 다음 번에 이전 사용자를 다시 선택했을 때 useEffect가 정상적으로 실행됩니다.
      if (process.env.NODE_ENV === 'development' && currentUserId) {
        initializationAttemptedForUser.current.delete(currentUserId);
      }
      setCurrentUserId(newUserId);

      const otherUsers = USER_IDS.filter(id => id !== newUserId);
      if (otherUsers.length > 0) {
        setRecipientId(otherUsers[0]);
      } else {
        setRecipientId('');
      }
    }
  };
  const handleRecipientSelect = (selectedRecipientId) => {
    if (selectedRecipientId !== recipientId) { setRecipientId(selectedRecipientId); }
  };
  const formatTimestamp = (date) => {
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  if (!isSodiumReady) { return <div className="App-container"><h1>Sodium 라이브러리 로딩 중...</h1></div>;}
  return ( /* ... 이전 JSX와 동일 ... */
    <div className="App-layout">
      <aside className="sidebar">
        <div className="current-user-selector">
          <label htmlFor="user-select">현재 사용자: </label>
          <select id="user-select" value={currentUserId} onChange={handleUserChange}>
            <option value="">-- 사용자 선택 --</option>
            {USER_IDS.map(id => (
              <option key={id} value={id}>{id.replace('_ws', '')}</option>
            ))}
          </select>
        </div>
        {currentUserId && (
          <>
            <h3>대화 상대</h3>
            <ul className="user-list">
              {USER_IDS.filter(id => id !== currentUserId).map(id => (
                <li
                  key={id}
                  className={`user-list-item ${recipientId === id ? 'active' : ''}`}
                  onClick={() => handleRecipientSelect(id)}
                >
                  {id.replace('_ws', '')}
                  {unreadCounts[id] > 0 && (
                    <span className="unread-badge">{unreadCounts[id]}</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
      <main className="chat-area">
        <header className="App-header">
          <h1>Privlychat</h1>
          {currentUserId && recipientId && ( <p>대화 상대: {recipientId.replace('_ws', '')}</p> )}
          {!currentUserId && <p>사용자를 선택해주세요.</p>}
          {currentUserId && !recipientId && <p>대화 상대를 선택해주세요.</p>}
          {serverInfo && <p className="server-info">서버: {serverInfo}</p>}
          {errorInfo && <p className="error-info">오류: {errorInfo}</p>}
        </header>
        {currentUserId && recipientId ? (
          <>
            <div className="chat-window">
              <div className="messages-list">
                {messages.map((msg, index) => (
                  <div key={index} className={`message-item-wrapper ${msg.type}`}>
                    <div className="message-item">
                      <div className="message-sender">
                        <strong>{msg.sender === currentUserId ? '나' : msg.sender.replace('_ws', '')}</strong>
                      </div>
                      <div className="message-text">{msg.text}</div>
                      <div className="message-timestamp">{formatTimestamp(msg.timestamp)}</div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>
            <footer className="App-footer">
              <input
                type="text"
                className="message-input"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={`${recipientId.replace('_ws','')}에게 메시지 보내기...`}
                disabled={!ws || ws.readyState !== WebSocket.OPEN || !currentUserKeysRef.current}
              />
              <button
                className="send-button"
                onClick={handleSendMessage}
                disabled={!ws || ws.readyState !== WebSocket.OPEN || !currentUserKeysRef.current}
              >
                전송
              </button>
            </footer>
          </>
        ) : (
          <div className="no-chat-selected">
            {currentUserId ? "대화 상대를 선택해주세요." : "먼저 사용자를 선택해주세요."}
          </div>
        )}
      </main>
    </div>
  );
}
