// client/src/App.js
import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import sodium from 'libsodium-wrappers';

import { generateCryptoBoxKeyPair, registerPublicKey, fetchPublicKey } from './crypto/crypto_box_keys';
import { encryptMessage, decryptMessage } from './crypto/crypto_box_message';

const WEBSOCKET_URL = 'ws://localhost:8080';
const USER_IDS = ['alice_ws', 'bob_ws', 'charlie_ws'];
const LOCAL_STORAGE_KEY_PREFIX = 'privlychat_userkeys_';

export default function App() {
  const [currentUserId, setCurrentUserId] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [ws, setWs] = useState(null);
  const [serverInfo, setServerInfo] = useState('사용자를 선택해주세요.');
  const [errorInfo, setErrorInfo] = useState('');
  const [isSodiumReady, setIsSodiumReady] = useState(false);

  const currentUserKeysRef = useRef(null);
  const messagesEndRef = useRef(null);
  const effectRanForUser = useRef(new Set()); // StrictMode 중복 실행 방지용

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

    if (ws) {
      console.log(`[Effect ${currentUserId}] 이전 WebSocket 연결 (URL: ${ws.url}) 닫는 중...`);
      ws.close();
      setWs(null);
    }
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
        }
        currentUserKeysRef.current = keys; // 현재 사용자의 키로 설정 (가장 중요!)

        // ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ 핵심 수정 부분 ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
        // localStorage에서 로드했든 새로 생성했든,
        // 현재 활성화되는 사용자의 공개키를 서버에 "알립니다"(등록 또는 갱신).
        // 이렇게 하면 서버가 재시작되었더라도 클라이언트가 활성화될 때 키가 다시 서버에 알려집니다.
        console.log(`[${currentUserId}] 공개키 서버 등록/갱신 시도...`);
        await registerPublicKey(currentUserId, keys.publicKey);
        console.log(`[${currentUserId}]의 공개키 서버 등록/갱신 완료.`);
        // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ 핵심 수정 부분 ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

        console.log(`[${currentUserId}] WebSocket 서버 연결 시도... (${WEBSOCKET_URL}?userId=${currentUserId})`);
        const newWs = new WebSocket(`${WEBSOCKET_URL}?userId=${currentUserId}`);
        newWs.onopen = () => {
          console.log(`[WS ${currentUserId}] 서버에 연결됨.`);
          setServerInfo(`'${currentUserId.replace('_ws','')}' 사용자로 서버에 연결되었습니다.`);
          setWs(newWs);
          if (process.env.NODE_ENV === 'development') {
            effectRanForUser.current.add(currentUserId);
          }
        };
        // ... (onmessage, onclose, onerror 핸들러는 이전과 동일)
        newWs.onmessage = (event) => {
          try {
            const receivedMsg = JSON.parse(event.data);
            if (receivedMsg.type === 'message' && receivedMsg.senderId && receivedMsg.payload) {
              if (receivedMsg.senderId === recipientId || currentUserId === receivedMsg.recipientId) {
                handleIncomingMessage(receivedMsg.senderId, receivedMsg.payload);
              } else { console.log(`[WS ${currentUserId}] ${receivedMsg.senderId}로부터 메시지 수신 (현재 채팅 상대 아님).`);}
            } else if (receivedMsg.type === 'info') { setServerInfo(receivedMsg.message);
            } else if (receivedMsg.type === 'error') { setErrorInfo(`서버 오류: ${receivedMsg.message}`); }
          } catch (e) { console.error('수신 메시지 파싱 오류:', e); setErrorInfo('수신 메시지 처리 중 오류.'); }
        };
        newWs.onclose = (event) => {
          console.log(`[WS ${currentUserId}] 서버와 연결 끊김. Code: ${event.code}, Reason: ${event.reason}`);
          setServerInfo('서버와 연결이 끊어졌습니다.');
          if (ws === newWs) { setWs(null); }
          if (process.env.NODE_ENV === 'development') { effectRanForUser.current.delete(currentUserId); }
        };
        newWs.onerror = (error) => {
          console.error(`[WS ${currentUserId}] WebSocket 오류:`, error);
          setErrorInfo('WebSocket 연결 오류.');
          if (ws === newWs) { setWs(null); }
          if (process.env.NODE_ENV === 'development') { effectRanForUser.current.delete(currentUserId); }
        };
      } catch (err) {
        console.error(`[${currentUserId}] 사용자 초기화 중 심각한 오류:`, err);
        setErrorInfo(`초기화 오류: ${err.message}`);
        setWs(null); currentUserKeysRef.current = null;
        if (process.env.NODE_ENV === 'development') { effectRanForUser.current.delete(currentUserId); }
      }
    };

    initializeUser();

    return () => { /* ... 이전과 동일 ... */
      console.log(`useEffect 클린업 (currentUserId: ${currentUserId}).`);
      if (ws && ws.url.includes(`userId=${currentUserId}`)) {
        console.log(`[클린업 ${currentUserId}] WebSocket 연결 닫는 중 (URL: ${ws.url}).`);
        ws.close();
      }
    };
  }, [currentUserId, isSodiumReady]);

  // ... (handleIncomingMessage, handleSendMessage, handleUserChange, formatTimestamp 및 JSX는 이전과 동일) ...
  const handleIncomingMessage = async (senderId, payload) => {
    if (!currentUserKeysRef.current || !currentUserKeysRef.current.privateKey) {
      console.error(`[${currentUserId} RECV] 나의 개인키(ref)가 없습니다. 복호화 불가.`);
      setErrorInfo('개인키(ref)가 없어 메시지를 복호화할 수 없습니다.');
      return;
    }
    try {
      const senderPublicKeyB64 = await fetchPublicKey(senderId);
      if (!senderPublicKeyB64) throw new Error(`${senderId}의 공개키를 찾을 수 없습니다.`);
      const decryptedText = await decryptMessage(
        payload.ciphertextB64, payload.nonceB64,
        senderPublicKeyB64, currentUserKeysRef.current.privateKey
      );
      setMessages(prev => [...prev, { sender: senderId, text: decryptedText, type: 'received', timestamp: new Date() }]);
    } catch (error) {
      console.error(`[${currentUserId} RECV] 메시지 복호화 중 오류:`, error);
      setErrorInfo(`메시지 복호화 실패: ${error.message}`);
      setMessages(prev => [...prev, { sender: senderId, text: `(암호문 복호화 실패)`, type: 'received-error', timestamp: new Date() }]);
    }
  };

  const handleSendMessage = async () => {
    if (!currentUserId || !messageInput.trim() || !ws || ws.readyState !== WebSocket.OPEN || !currentUserKeysRef.current?.privateKey || !recipientId) {
      setErrorInfo('메시지 전송 불가: 사용자, 메시지, 연결, 키, 수신자 상태를 확인하세요.'); return;
    }
    setErrorInfo('');
    try {
      const recipientPublicKeyB64 = await fetchPublicKey(recipientId);
      if (!recipientPublicKeyB64) throw new Error(`${recipientId} 공개키 없음`);
      const encryptedPayload = await encryptMessage(messageInput, recipientPublicKeyB64, currentUserKeysRef.current.privateKey);
      const messageToSend = { type: 'message', recipientId: recipientId, payload: encryptedPayload };
      ws.send(JSON.stringify(messageToSend));
      setMessages(prev => [...prev, { sender: currentUserId, text: messageInput, type: 'sent', timestamp: new Date() }]);
      setMessageInput('');
    } catch (error) {
      console.error(`[${currentUserId} SEND] 메시지 전송 중 오류:`, error);
      setErrorInfo(`메시지 전송 실패: ${error.message}`);
    }
  };

  const handleUserChange = (event) => {
    const newUserId = event.target.value;
    if (newUserId !== currentUserId) {
      setCurrentUserId(newUserId);
      const otherUsers = USER_IDS.filter(id => id !== newUserId);
      if (otherUsers.length > 0) { setRecipientId(otherUsers[0]); }
      else { setRecipientId(''); }
    }
  };

  const formatTimestamp = (date) => {
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  if (!isSodiumReady) {
    return <div className="App-container"><h1>Sodium 라이브러리 로딩 중...</h1></div>;
  }
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
                  onClick={() => setRecipientId(id)}
                >
                  {id.replace('_ws', '')}
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
      <main className="chat-area">
        <header className="App-header">
          <h1>Privlychat™</h1>
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
