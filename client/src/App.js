// client/src/App.js
import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import sodium from 'libsodium-wrappers';

import { generateCryptoBoxKeyPair, registerPublicKey, fetchPublicKey } from './crypto/crypto_box_keys';
import { encryptMessage, decryptMessage } from './crypto/crypto_box_message';

const WEBSOCKET_URL = 'ws://localhost:8080';
const USER_IDS = ['alice_ws', 'bob_ws', 'charlie_ws'];

export default function App() {
  const [currentUserId, setCurrentUserId] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [messages, setMessages] = useState([]);
  // const [userKeys, setUserKeys] = useState(null); // 상태로도 유지할 수 있지만, ref를 우선 사용
  const [ws, setWs] = useState(null);
  const [serverInfo, setServerInfo] = useState('사용자를 선택해주세요.');
  const [errorInfo, setErrorInfo] = useState('');
  const [isSodiumReady, setIsSodiumReady] = useState(false);

  const userKeysCache = useRef(new Map());
  const initializedUsers = useRef(new Set());
  const currentUserKeysRef = useRef(null); // << 현재 사용자의 키 쌍을 저장할 ref

  useEffect(() => {
    const initSodium = async () => {
      await sodium.ready;
      setIsSodiumReady(true);
      console.log("Sodium 라이브러리 로드 완료.");
    };
    initSodium();
  }, []);

  useEffect(() => {
    if (!isSodiumReady) {
      console.log("useEffect: Sodium 아직 준비 안됨, 대기.");
      return;
    }

    if (!currentUserId) {
      console.log("useEffect: currentUserId가 선택되지 않았습니다.");
      setServerInfo('먼저 사용자를 선택해주세요.');
      if (ws) { ws.close(); setWs(null); }
      currentUserKeysRef.current = null; // 키 ref도 초기화
      // setUserKeys(null); // 상태도 필요하다면 초기화
      setMessages([]);
      return;
    }

    if (process.env.NODE_ENV === 'development' && initializedUsers.current.has(currentUserId)) {
      console.log(`[${currentUserId}] StrictMode: 이미 초기화된 사용자입니다. useEffect 실행을 건너뜁니다.`);
      return;
    }

    console.log(`[${currentUserId}] 사용자 초기화 및 WebSocket 연결 시작...`);
    setMessages([]);
    setErrorInfo('');
    setServerInfo('사용자 초기화 중...');

    if (ws) {
      console.log(`[${currentUserId}] 이전 WebSocket 연결 (URL: ${ws.url}) 닫는 중...`);
      ws.close();
    }

    const setupUserAndConnect = async () => {
      try {
        let keysToUse;
        if (userKeysCache.current.has(currentUserId)) {
          keysToUse = userKeysCache.current.get(currentUserId);
          console.log(`[${currentUserId}] 캐시에서 키 로드. 공개키: ${keysToUse.publicKey.slice(0,10)}...`);
        } else {
          console.log(`[${currentUserId}] 새 키 쌍 생성 중...`);
          keysToUse = await generateCryptoBoxKeyPair();
          userKeysCache.current.set(currentUserId, keysToUse);
          console.log(`[${currentUserId}] 새 키 생성 및 캐시 완료. 공개키: ${keysToUse.publicKey.slice(0,10)}...`);
          await registerPublicKey(currentUserId, keysToUse.publicKey);
          console.log(`[${currentUserId}]의 새 공개키 서버 등록 완료.`);
        }
        // setUserKeys(keysToUse); // 상태 업데이트는 여전히 유용할 수 있음 (UI 등)
        currentUserKeysRef.current = keysToUse; // << Ref에 현재 사용자의 키를 즉시 할당!

        console.log(`[${currentUserId}] WebSocket 서버 연결 시도... (${WEBSOCKET_URL}?userId=${currentUserId})`);
        const newWs = new WebSocket(`${WEBSOCKET_URL}?userId=${currentUserId}`);

        newWs.onopen = () => {
          console.log(`[WS ${currentUserId}] 서버에 연결됨.`);
          setServerInfo('서버에 연결되었습니다.');
          setWs(newWs);
          if (process.env.NODE_ENV === 'development') {
            initializedUsers.current.add(currentUserId);
          }
        };
        newWs.onmessage = (event) => {
          try {
            const receivedMsg = JSON.parse(event.data);
            console.log(`[WS ${currentUserId}] 메시지 수신:`, receivedMsg);
            if (receivedMsg.type === 'message' && receivedMsg.senderId && receivedMsg.payload) {
              handleIncomingMessage(receivedMsg.senderId, receivedMsg.payload);
            } else if (receivedMsg.type === 'info') { setServerInfo(receivedMsg.message);
            } else if (receivedMsg.type === 'error') { setErrorInfo(`서버 오류: ${receivedMsg.message}`); }
          } catch (e) { console.error('수신 메시지 파싱 오류:', e); setErrorInfo('수신 메시지 처리 중 오류.'); }
        };
        newWs.onclose = (event) => {
          console.log(`[WS ${currentUserId}] 서버와 연결 끊김. Code: ${event.code}, Reason: ${event.reason}`);
          setServerInfo('서버와 연결이 끊어졌습니다.');
          if (ws === newWs) { setWs(null); }
        };
        newWs.onerror = (error) => {
          console.error(`[WS ${currentUserId}] WebSocket 오류:`, error);
          setErrorInfo('WebSocket 연결 오류.');
          if (ws === newWs) { setWs(null); }
        };
      } catch (err) {
        console.error(`[${currentUserId}] 설정 및 연결 중 오류:`, err);
        setErrorInfo(`초기화 오류: ${err.message}`);
        setWs(null);
        currentUserKeysRef.current = null; // 오류 시 ref도 초기화
      }
    };

    setupUserAndConnect();

    return () => {
      console.log(`useEffect 클린업 (currentUserId: ${currentUserId}). WebSocket 정리 시도.`);
      if (ws) {
        console.log(`[클린업 ${currentUserId}] WebSocket 연결 닫는 중 (URL: ${ws.url}).`);
        ws.close();
      }
    };
  }, [currentUserId, isSodiumReady]); // ws 의존성 제거

  const handleIncomingMessage = async (senderId, payload) => {
    // ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ userKeys 상태 대신 currentUserKeysRef.current 사용 ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
    if (!currentUserKeysRef.current || !currentUserKeysRef.current.privateKey) {
      console.error(`[${currentUserId} RECV] 나의 개인키(ref)가 없습니다. 복호화 불가.`);
      setErrorInfo('개인키(ref)가 없어 메시지를 복호화할 수 없습니다.');
      return;
    }
    // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ userKeys 상태 대신 currentUserKeysRef.current 사용 ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
    try {
      console.log(`[${currentUserId} RECV] 수신 메시지 복호화 시도... 송신자: ${senderId}`);
      const senderPublicKeyB64 = await fetchPublicKey(senderId);
      if (!senderPublicKeyB64) throw new Error(`${senderId}의 공개키를 찾을 수 없습니다.`);
      console.log(`[${currentUserId} RECV] ${senderId}의 공개키 가져옴: ${senderPublicKeyB64.slice(0,10)}...`);

      console.log(`[${currentUserId} RECV DECRYPT] 사용될 키:`);
      console.log(`  송신자(상대) 공개키 (Base64): ${senderPublicKeyB64.slice(0,10)}...`);
      // ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ userKeys 상태 대신 currentUserKeysRef.current 사용 ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
      console.log(`  나(수신자) 개인키 (Base64): ${currentUserKeysRef.current.privateKey.slice(0,10)}...`);

      const decryptedText = await decryptMessage(
        payload.ciphertextB64, payload.nonceB64,
        senderPublicKeyB64, currentUserKeysRef.current.privateKey // Ref 사용
      );
      // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ userKeys 상태 대신 currentUserKeysRef.current 사용 ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
      console.log(`[${currentUserId} RECV] 복호화된 평문: "${decryptedText}"`);
      setMessages(prev => [...prev, { sender: senderId, text: decryptedText, type: 'received' }]);
    } catch (error) {
      console.error(`[${currentUserId} RECV] 메시지 복호화 중 오류:`, error);
      setErrorInfo(`메시지 복호화 실패: ${error.message}`);
      setMessages(prev => [...prev, { sender: senderId, text: `(암호문 복호화 실패)`, type: 'received-error' }]);
    }
  };

  const handleSendMessage = async () => {
    if (!currentUserId) { setErrorInfo('먼저 사용자를 선택해주세요.'); return; }
    if (!messageInput.trim()) { setErrorInfo('메시지를 입력하세요.'); return; }
    if (!ws || ws.readyState !== WebSocket.OPEN) { setErrorInfo('WebSocket이 연결되지 않았습니다.'); return; }
    // ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ userKeys 상태 대신 currentUserKeysRef.current 사용 ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
    if (!currentUserKeysRef.current || !currentUserKeysRef.current.privateKey) {
      setErrorInfo('키(ref)가 없습니다. 메시지를 암호화할 수 없습니다.');
      return;
    }
    // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ userKeys 상태 대신 currentUserKeysRef.current 사용 ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
    if (!recipientId) { setErrorInfo('수신자를 선택하세요.'); return; }
    setErrorInfo('');

    try {
      console.log(`[${currentUserId} SEND] ${recipientId}에게 메시지 암호화 및 전송 시도... 원본: "${messageInput}"`);
      const recipientPublicKeyB64 = await fetchPublicKey(recipientId);
      if (!recipientPublicKeyB64) throw new Error(`${recipientId}의 공개키를 찾을 수 없습니다.`);
      console.log(`[${currentUserId} SEND] ${recipientId}의 공개키 가져옴: ${recipientPublicKeyB64.slice(0,10)}...`);

      console.log(`[${currentUserId} SEND ENCRYPT] 사용될 키:`);
      // ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ userKeys 상태 대신 currentUserKeysRef.current 사용 ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
      console.log(`  나(송신자) 개인키 (Base64): ${currentUserKeysRef.current.privateKey.slice(0,10)}...`);
      console.log(`  수신자(상대) 공개키 (Base64): ${recipientPublicKeyB64.slice(0,10)}...`);

      const encryptedPayload = await encryptMessage(messageInput, recipientPublicKeyB64, currentUserKeysRef.current.privateKey); // Ref 사용
      // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ userKeys 상태 대신 currentUserKeysRef.current 사용 ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
      const messageToSend = { type: 'message', recipientId: recipientId, payload: encryptedPayload };
      ws.send(JSON.stringify(messageToSend));
      console.log(`[${currentUserId} SEND] ${recipientId}에게 메시지 전송 완료.`);
      setMessages(prev => [...prev, { sender: currentUserId, text: messageInput, type: 'sent' }]);
      setMessageInput('');
    } catch (error) {
      console.error(`[${currentUserId} SEND] 메시지 전송 중 오류:`, error);
      setErrorInfo(`메시지 전송 실패: ${error.message}`);
    }
  };

  // handleUserChange 함수는 이전과 동일
  const handleUserChange = (event) => {
    const newUserId = event.target.value;
    console.log(`사용자 선택 변경: ${newUserId}`);
    // initializedUsers.current.delete(currentUserId); // 이전 사용자의 초기화 상태를 여기서 지울 필요는 없음
    setCurrentUserId(newUserId);

    const otherUsers = USER_IDS.filter(id => id !== newUserId);
    if (otherUsers.length > 0) {
      setRecipientId(otherUsers[0]);
    } else {
      setRecipientId('');
    }
  };

  // UI 렌더링 부분은 이전과 동일
  if (!isSodiumReady) {
    return <div className="App-container"><h1>Sodium 라이브러리 로딩 중...</h1></div>;
  }
  return (
    <div className="App-container">
      <header className="App-header">
        <h1>Privlychat™ (crypto_box + WebSocket)</h1>
        <div className="user-select-container">
          <label htmlFor="user-select">현재 사용자: </label>
          <select id="user-select" value={currentUserId} onChange={handleUserChange}>
            <option value="">-- 사용자 선택 --</option>
            {USER_IDS.map(id => (
              <option key={id} value={id}>{id.replace('_ws', '')}</option>
            ))}
          </select>
        </div>
        {currentUserId && recipientId && (
          <p>메시지 상대방:
            <select value={recipientId} onChange={(e) => setRecipientId(e.target.value)} disabled={!currentUserId}>
              {USER_IDS.filter(id => id !== currentUserId).map(id => (
                <option key={id} value={id}>{id.replace('_ws', '')}</option>
              ))}
            </select>
          </p>
        )}
        {serverInfo && <p className="server-info">서버: {serverInfo}</p>}
        {errorInfo && <p className="error-info">오류: {errorInfo}</p>}
      </header>

      {currentUserId && (
        <>
          <div className="chat-window">
            <div className="messages-list">
              {messages.map((msg, index) => (
                <div key={index} className={`message-item ${msg.type}`}>
                  <strong>{msg.sender === currentUserId ? '나' : msg.sender.replace('_ws', '')}: </strong>{msg.text}
                </div>
              ))}
            </div>
          </div>
          <footer className="App-footer">
            <input
              type="text"
              className="message-input"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="메시지를 입력하세요..."
              disabled={!ws || ws.readyState !== WebSocket.OPEN || !currentUserKeysRef.current || !recipientId}
            />
            <button
              className="send-button"
              onClick={handleSendMessage}
              disabled={!ws || ws.readyState !== WebSocket.OPEN || !currentUserKeysRef.current || !recipientId}
            >
              전송
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
