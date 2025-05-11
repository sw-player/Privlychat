// client/src/App.js
import React, { useState, useEffect, useRef, useCallback } from 'react'; // useCallback 추가
import './App.css';
import sodium from 'libsodium-wrappers';

import { generateCryptoBoxKeyPair, registerPublicKey, fetchPublicKey } from './crypto/crypto_box_keys';
import { encryptMessage, decryptMessage } from './crypto/crypto_box_message';

const WEBSOCKET_URL = 'ws://localhost:8080';
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
  const handleIncomingMessage = useCallback(async (senderId, payload, isCurrentChat) => {
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
      
      const conversationKey = getConversationKey(currentUserId, senderId);
      const storedMessagesString = localStorage.getItem(conversationKey);
      let currentConversationMessages = [];
      if (storedMessagesString) {
        try { currentConversationMessages = JSON.parse(storedMessagesString); }
        catch (e) { console.error(`메시지 저장 중 ${conversationKey} 파싱 오류:`, e); }
      }
      currentConversationMessages.push(newMessage);
      localStorage.setItem(conversationKey, JSON.stringify(currentConversationMessages));
      console.log(`${conversationKey}에 메시지 저장 완료. 총 ${currentConversationMessages.length}개.`);

      if (isCurrentChat) {
        setMessages(prev => [...prev, newMessage]);
      } else {
        console.log(`${senderId}로부터 온 새 메시지를 백그라운드에 저장 및 알림 처리됨.`);
      }
    } catch (error) {
      console.error(`[${currentUserId} RECV] 메시지 복호화 오류:`, error);
      setErrorInfo(`메시지 복호화 실패: ${error.message}`);
      if (isCurrentChat) {
        setMessages(prev => [...prev, { sender: senderId, text: `(암호문 복호화 실패)`, type: 'received-error', timestamp: new Date() }]);
      }
    }
  }, [currentUserId]); // currentUserId가 변경되면 이 함수도 새로 생성되어야 함

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

        const newWs = new WebSocket(`${WEBSOCKET_URL}?userId=${currentUserId}`);
        newWs.onopen = () => {
          console.log(`[WS ${currentUserId}] 서버에 연결됨.`);
          setServerInfo(`'${currentUserId.replace('_ws','')}' 사용자로 서버에 연결되었습니다.`);
          setWs(newWs);
          if (process.env.NODE_ENV === 'development') {
            effectRanForUser.current.add(currentUserId);
          }
        };
        newWs.onmessage = (event) => {
          try {
            const receivedMsg = JSON.parse(event.data);
            console.log(`[WS ${currentUserId}] 메시지 수신:`, receivedMsg);
            if (receivedMsg.type === 'message' && receivedMsg.senderId && receivedMsg.payload) {
              const isCurrentChatActive = receivedMsg.senderId === recipientId;
              if (!isCurrentChatActive) { // 현재 채팅 상대가 아닌 경우에만 unreadCounts 업데이트
                setUnreadCounts(prevCounts => ({
                  ...prevCounts,
                  [receivedMsg.senderId]: (prevCounts[receivedMsg.senderId] || 0) + 1,
                }));
                console.log(`[Unread] ${receivedMsg.senderId}로부터 새 메시지. 현재 unread:`, (unreadCounts[receivedMsg.senderId] || 0) + 1);
              }
              handleIncomingMessage(receivedMsg.senderId, receivedMsg.payload, isCurrentChatActive);
            } else if (receivedMsg.type === 'info') { setServerInfo(receivedMsg.message);
            } else if (receivedMsg.type === 'error') { setErrorInfo(`서버 오류: ${receivedMsg.message}`); }
          } catch (e) { console.error('수신 메시지 파싱 오류:', e); setErrorInfo('수신 메시지 처리 중 오류.'); }
        };
        newWs.onclose = (event) => {
          console.log(`[WS ${currentUserId}] 서버와 연결 끊김.`);
          setServerInfo('서버와 연결이 끊어졌습니다.');
          if (ws === newWs) { setWs(null); }
          if (process.env.NODE_ENV === 'development') {
            effectRanForUser.current.delete(currentUserId);
          }
        };
        newWs.onerror = (error) => {
          console.error(`[WS ${currentUserId}] WebSocket 오류:`, error);
          setErrorInfo('WebSocket 연결 오류.');
          if (ws === newWs) { setWs(null); }
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
      if (ws && ws.url.includes(`userId=${currentUserId}`)) { ws.close(); }
    };
  // ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ 의존성 배열 수정 ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
  }, [currentUserId, isSodiumReady, recipientId, handleIncomingMessage, unreadCounts]);
  // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ 의존성 배열 수정 ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

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

  const saveMessageToLocalStorage = (newMessage, convKeyUserId1, convKeyUserId2) => { /* ... 이전과 동일 ... */
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

  const handleSendMessage = async () => { /* ... 이전과 동일 ... */
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

  const handleUserChange = (event) => { /* ... 이전과 동일 ... */
    const newUserId = event.target.value;
    if (newUserId !== currentUserId) { setCurrentUserId(newUserId);
      const otherUsers = USER_IDS.filter(id => id !== newUserId);
      if (otherUsers.length > 0) { setRecipientId(otherUsers[0]); }
      else { setRecipientId(''); }
    }
  };
  const handleRecipientSelect = (selectedRecipientId) => { /* ... 이전과 동일 ... */
    if (selectedRecipientId !== recipientId) { setRecipientId(selectedRecipientId); }
  };
  const formatTimestamp = (date) => { /* ... 이전과 동일 ... */
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  if (!isSodiumReady) { /* ... 이전과 동일 ... */ }
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
