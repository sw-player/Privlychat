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
  const [ws, setWs] = useState(null); // WebSocket 연결 객체 상태
  const [serverInfo, setServerInfo] = useState('사용자를 선택해주세요.');
  const [errorInfo, setErrorInfo] = useState('');
  const [isSodiumReady, setIsSodiumReady] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState({});

  const currentUserKeysRef = useRef(null);
  const messagesEndRef = useRef(null);
  const effectRanForUser = useRef(new Set());

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
  }, [currentUserId]);

  // 사용자 초기화 및 WebSocket 연결을 담당하는 주 useEffect
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
      return;
    }

    if (process.env.NODE_ENV === 'development' && effectRanForUser.current.has(currentUserId)) {
      console.log(`[Effect ${currentUserId}] StrictMode: 이미 이 사용자(${currentUserId})로 설정 완료됨. 건너뜁니다.`);
      return;
    }

    console.log(`[Effect ${currentUserId}] 사용자 초기화 및 WebSocket 연결 시작...`);
    setMessages([]);
    setErrorInfo('');
    setServerInfo(`'${currentUserId.replace('_ws','')}' 사용자 초기화 중...`);

    let newWsInstance = null; 

    const initializeUser = async () => {
      try {
        if (ws) { // 이 useEffect가 currentUserId 변경으로 실행될 때 이전 사용자의 ws를 닫음
          console.log(`[Effect InitializeUser ${currentUserId}] 이전 WebSocket 연결 (URL: ${ws.url}) 닫는 중...`);
          ws.close();
          // setWs(null); // 여기서 setWs(null)을 하면 루프 유발 가능성 있음 (ws가 의존성 배열에 있다면)
        }
        currentUserKeysRef.current = null;

        let keys;
        const localStorageKey = `${LOCAL_STORAGE_KEY_PREFIX}${currentUserId}`;
        const storedKeysString = localStorage.getItem(localStorageKey);

        if (storedKeysString) {
          try {
            keys = JSON.parse(storedKeysString);
            if (!keys || !keys.publicKey || !keys.privateKey) throw new Error('Invalid stored key format');
            console.log(`[${currentUserId}] localStorage에서 키 로드 성공.`);
          } catch (e) {
            console.warn(`[${currentUserId}] localStorage 키 파싱 오류. 새 키 생성.`, e);
            localStorage.removeItem(localStorageKey); keys = null;
          }
        }

        if (!keys) {
          console.log(`[${currentUserId}] 새 키 쌍 생성 중...`);
          keys = await generateCryptoBoxKeyPair();
          localStorage.setItem(localStorageKey, JSON.stringify(keys));
          console.log(`[${currentUserId}] 새 키 생성 및 localStorage 저장 완료.`);
          await registerPublicKey(currentUserId, keys.publicKey);
          console.log(`[${currentUserId}]의 공개키 서버 등록 완료.`);
        } else {
          console.log(`[${currentUserId}] localStorage 키 사용. 서버에 공개키 (재)등록 시도...`);
          await registerPublicKey(currentUserId, keys.publicKey);
          console.log(`[${currentUserId}]의 공개키 서버 등록/갱신 완료.`);
        }
        currentUserKeysRef.current = keys;

        console.log(`[${currentUserId}] WebSocket 서버 연결 시도... (${WEBSOCKET_URL}?userId=${currentUserId})`);
        newWsInstance = new WebSocket(`${WEBSOCKET_URL}?userId=${currentUserId}`);

        newWsInstance.onopen = () => {
          console.log(`[WS ${currentUserId}] 서버에 연결됨.`);
          setServerInfo(`'${currentUserId.replace('_ws','')}' 사용자로 서버에 연결되었습니다.`);
          setWs(newWsInstance); 
          if (process.env.NODE_ENV === 'development') {
            effectRanForUser.current.add(currentUserId);
          }
        };
        newWsInstance.onmessage = (event) => {
          try {
            const receivedMsg = JSON.parse(event.data);
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
        newWsInstance.onclose = (event) => {
          console.log(`[WS ${currentUserId}] 서버와 연결 끊김. Code: ${event.code}, Reason: ${event.reason}`);
          setServerInfo('서버와 연결이 끊어졌습니다.');
          setWs(prevWs => (prevWs === newWsInstance ? null : prevWs));
          if (process.env.NODE_ENV === 'development') {
            effectRanForUser.current.delete(currentUserId);
          }
        };
        newWsInstance.onerror = (error) => {
          console.error(`[WS ${currentUserId}] WebSocket 오류:`, error);
          setErrorInfo('WebSocket 연결 오류.');
          setWs(prevWs => (prevWs === newWsInstance ? null : prevWs));
          if (process.env.NODE_ENV === 'development') {
            effectRanForUser.current.delete(currentUserId);
          }
        };
      } catch (err) {
        console.error(`[${currentUserId}] 사용자 초기화 중 심각한 오류:`, err);
        setErrorInfo(`초기화 오류: ${err.message}`);
        setWs(null); currentUserKeysRef.current = null;
        if (process.env.NODE_ENV === 'development') {
          effectRanForUser.current.delete(currentUserId);
        }
      }
    };

    initializeUser();

    return () => {
      console.log(`useEffect 클린업 (currentUserId: ${currentUserId}).`);
      if (newWsInstance) { // 이 effect 실행에서 생성된 인스턴스를 닫음
        console.log(`[클린업 ${currentUserId}] 생성된 WebSocket 인스턴스 닫는 중 (URL: ${newWsInstance.url}).`);
        newWsInstance.close();
      } else if (ws && ws.url.includes(`userId=${currentUserId}`)) {
        // newWsInstance가 할당되기 전에 cleanup이 호출되거나, 이전 상태의 ws를 닫아야 할 경우
        console.log(`[클린업 ${currentUserId}] 상태에 있던 WebSocket 연결 닫는 중 (URL: ${ws.url}).`);
        ws.close();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, isSodiumReady, recipientId, handleIncomingMessage, unreadCounts]);
  // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ ESLint 비활성화 주석 추가 ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

  // recipientId 또는 currentUserId가 변경될 때 메시지 로드 및 읽음 처리 useEffect
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
  }, [recipientId, currentUserId, isSodiumReady, unreadCounts]);


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
    if (newUserId !== currentUserId) { 
      // 이전 사용자에 대한 effectRanForUser 상태를 여기서 지우지 않습니다.
      // useEffect가 currentUserId 변경에 따라 실행될 때 내부적으로 처리합니다.
      setCurrentUserId(newUserId);
      const otherUsers = USER_IDS.filter(id => id !== newUserId);
      if (otherUsers.length > 0) { setRecipientId(otherUsers[0]); }
      else { setRecipientId(''); }
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
