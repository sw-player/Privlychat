// client/src/App.js
import React, { useState, useEffect, useRef, useCallback } from 'react'; // useCallback 추가
import './App.css';
import sodium from 'libsodium-wrappers';

import { generateCryptoBoxKeyPair, registerPublicKey, fetchPublicKey } from './crypto/crypto_box_keys';
import { encryptMessage, decryptMessage } from './crypto/crypto_box_message';

const WEBSOCKET_URL = process.env.REACT_APP_WEBSOCKET_URL || 'https://privlychat.netlify.app/';
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

  // handleIncomingMessage 함수를 useCallback으로 메모이제이션
  // 이 함수는 currentUserId, recipientId, unreadCounts, (setMessages, setErrorInfo, setUnreadCounts - 이들은 안정적)에 의존합니다.
  // fetchPublicKey, decryptMessage도 외부 함수이므로 안정적입니다.
  // currentUserKeysRef는 ref이므로 의존성에 포함하지 않아도 됩니다.
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
      
      // 메시지를 localStorage에 저장 (현재 사용자와 송신자 ID 기준)
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
  }, [currentUserId]); // handleIncomingMessage는 currentUserId에만 의존 (setErrorInfo, setMessages는 안정적)

  useEffect(() => {
    if (!isSodiumReady) { return; }
    if (!currentUserId) {
      setServerInfo('먼저 사용자를 선택해주세요.');
      if (ws) { ws.close(); setWs(null); }
      currentUserKeysRef.current = null;
      setMessages([]);
      setRecipientId('');
      return;
    }

    if (process.env.NODE_ENV === 'development' && effectRanForUser.current.has(currentUserId)) {
      return;
    }

    console.log(`[Effect ${currentUserId}] 사용자 초기화 및 WebSocket 연결 시작...`);
    setMessages([]);
    setErrorInfo('');
    setServerInfo(`'${currentUserId.replace('_ws','')}' 사용자 초기화 중...`);

    if (ws) { ws.close(); setWs(null); }
    currentUserKeysRef.current = null;

    const initializeUser = async () => {
      try {
        let keys;
        const localStorageKey = `${LOCAL_STORAGE_KEY_PREFIX}${currentUserId}`;
        const storedKeysString = localStorage.getItem(localStorageKey);
        let serverRegistrationNeeded = false;

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
          serverRegistrationNeeded = true;
        }
        currentUserKeysRef.current = keys;

        if (serverRegistrationNeeded) {
          await registerPublicKey(currentUserId, keys.publicKey);
          console.log(`[${currentUserId}]의 공개키 서버 등록 완료.`);
        } else {
          // localStorage에 키가 있더라도, 서버가 재시작되었을 수 있으므로 현재 키를 서버에 알림 (덮어쓰기 또는 신규 등록)
          console.log(`[${currentUserId}] localStorage 키 사용. 서버에 공개키 (재)등록 시도...`);
          await registerPublicKey(currentUserId, keys.publicKey);
          console.log(`[${currentUserId}]의 공개키 서버 등록/갱신 완료.`);
        }

        const newWs = new WebSocket(`${WEBSOCKET_URL}?userId=${currentUserId}`);
        newWs.onopen = () => {
          console.log(`[WS ${currentUserId}] 서버에 연결됨.`);
          setServerInfo(`'${currentUserId.replace('_ws','')}' 사용자로 서버에 연결되었습니다.`);
          setWs(newWs); // ws 상태 업데이트
          if (process.env.NODE_ENV === 'development') {
            effectRanForUser.current.add(currentUserId);
          }
        };
        newWs.onmessage = (event) => {
          try {
            const receivedMsg = JSON.parse(event.data);
            console.log(`[WS ${currentUserId}] 메시지 수신:`, receivedMsg);
            if (receivedMsg.type === 'message' && receivedMsg.senderId && receivedMsg.payload) {
              const isCurrentChatActive = receivedMsg.senderId === recipientId; // recipientId 직접 참조
              if (!isCurrentChatActive) {
                setUnreadCounts(prevCounts => ({ // setUnreadCounts 직접 사용
                  ...prevCounts,
                  [receivedMsg.senderId]: (prevCounts[receivedMsg.senderId] || 0) + 1,
                }));
              }
              handleIncomingMessage(receivedMsg.senderId, receivedMsg.payload, isCurrentChatActive); // 메모이제이션된 handleIncomingMessage 사용
            } else if (receivedMsg.type === 'info') { setServerInfo(receivedMsg.message);
            } else if (receivedMsg.type === 'error') { setErrorInfo(`서버 오류: ${receivedMsg.message}`); }
          } catch (e) { console.error('수신 메시지 파싱 오류:', e); setErrorInfo('수신 메시지 처리 중 오류.'); }
        };
        newWs.onclose = (event) => {
          console.log(`[WS ${currentUserId}] 서버와 연결 끊김.`);
          setServerInfo('서버와 연결이 끊어졌습니다.');
          // ws 상태를 직접 비교하여 현재 활성화된 연결인지 확인 후 null로 설정
          setWs(prevWs => (prevWs === newWs ? null : prevWs));
          if (process.env.NODE_ENV === 'development') {
            effectRanForUser.current.delete(currentUserId);
          }
        };
        newWs.onerror = (error) => {
          console.error(`[WS ${currentUserId}] WebSocket 오류:`, error);
          setErrorInfo('WebSocket 연결 오류.');
          setWs(prevWs => (prevWs === newWs ? null : prevWs));
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
      // ws 상태가 아닌, 이 effect 스코프에서 생성된 newWs 인스턴스를 닫아야 하지만,
      // newWs는 initializeUser 스코프에 있으므로 직접 접근 불가.
      // 대신, ws 상태를 통해 현재 활성화된 연결을 닫도록 시도.
      setWs(prevWs => {
        if (prevWs && prevWs.url.includes(`userId=${currentUserId}`)) {
          console.log(`[클린업 ${currentUserId}] WebSocket 연결 닫는 중 (URL: ${prevWs.url}).`);
          prevWs.close();
        }
        return null; // 항상 null을 반환하여 이전 연결 정리
      });
    };
  // ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ 의존성 배열에 명시적으로 추가 ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
  }, [currentUserId, isSodiumReady, recipientId, handleIncomingMessage, unreadCounts, ws]);
  // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ 의존성 배열에 명시적으로 추가 ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

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

  // ... (saveMessageToLocalStorage, handleSendMessage, handleUserChange, handleRecipientSelect, formatTimestamp, JSX는 이전과 동일)
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
    if (newUserId !== currentUserId) { setCurrentUserId(newUserId);
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
  return (
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
