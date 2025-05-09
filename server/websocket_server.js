// server/websocket_server.js

const WebSocket = require('ws');

// 연결된 클라이언트들을 관리하기 위한 객체
// key: userId, value: WebSocket 객체
const clients = new Map();

// WebSocket 서버 생성 (예: 8080 포트 사용)
// 기존 HTTP 서버(예: Express)와 함께 사용하려면 해당 서버에 통합해야 합니다.
// 여기서는 독립적인 WebSocket 서버를 가정합니다.
const wss = new WebSocket.Server({ port: 8080 }, () => {
  console.log('[WebSocket 서버] 시작됨. 포트: 8080');
});

wss.on('connection', (ws, req) => {
  // 클라이언트가 연결될 때 userId를 쿼리 파라미터로 전달받는다고 가정합니다.
  // 예: ws://localhost:8080?userId=alice
  // URLSearchParams를 사용하여 쿼리 파라미터를 파싱합니다.
  // req.url은 '/?userId=alice' 와 같은 형태입니다.
  const parameters = new URLSearchParams(req.url.slice(req.url.startsWith('/') ? 1 : 0));
  const userId = parameters.get('userId');

  if (!userId) {
    console.log('[WebSocket 서버] userId 없이 연결 시도됨. 연결 종료.');
    ws.terminate(); // userId가 없으면 연결 종료
    return;
  }

  // 이미 해당 userId로 연결된 클라이언트가 있는지 확인 (선택적: 중복 로그인 방지)
  if (clients.has(userId)) {
    console.log(`[WebSocket 서버] ${userId}는 이미 연결되어 있습니다. 이전 연결을 종료합니다.`);
    clients.get(userId).terminate();
  }

  // 새로운 클라이언트 등록
  clients.set(userId, ws);
  console.log(`[WebSocket 서버] 클라이언트 연결됨: ${userId} (총 ${clients.size}명)`);

  // 클라이언트로부터 메시지를 수신했을 때의 이벤트 핸들러
  ws.on('message', (message) => {
    console.log(`[WebSocket 서버] ${userId}로부터 메시지 수신: ${message.toString().slice(0, 100)}...`);

    try {
      const parsedMessage = JSON.parse(message.toString());

      // 메시지 형식: { type: 'message', recipientId: 'bob', payload: { ...암호화된 내용... } }
      if (parsedMessage.type === 'message' && parsedMessage.recipientId && parsedMessage.payload) {
        const recipientWs = clients.get(parsedMessage.recipientId);

        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
          // 수신자에게 메시지 전달 (송신자 정보 추가 가능)
          const messageToSend = JSON.stringify({
            type: 'message',
            senderId: userId, // 송신자 ID 추가
            payload: parsedMessage.payload,
          });
          recipientWs.send(messageToSend);
          console.log(`[WebSocket 서버] ${userId}가 ${parsedMessage.recipientId}에게 메시지 전달 완료.`);
        } else {
          console.log(`[WebSocket 서버] 수신자 ${parsedMessage.recipientId}를 찾을 수 없거나 연결 상태가 좋지 않습니다.`);
          // (선택적) 송신자에게 수신자가 오프라인임을 알릴 수 있습니다.
          ws.send(JSON.stringify({
            type: 'error',
            message: `수신자 ${parsedMessage.recipientId}가 오프라인 상태입니다.`
          }));
        }
      } else {
        console.log(`[WebSocket 서버] ${userId}로부터 잘못된 형식의 메시지 수신:`, parsedMessage);
      }
    } catch (error) {
      console.error(`[WebSocket 서버] ${userId}로부터 받은 메시지 처리 중 오류:`, error);
      ws.send(JSON.stringify({
        type: 'error',
        message: '잘못된 메시지 형식입니다.'
      }));
    }
  });

  // 클라이언트 연결이 종료되었을 때의 이벤트 핸들러
  ws.on('close', () => {
    // clients Map에서 해당 사용자 제거
    // Map을 순회하며 value가 현재 ws와 같은 항목을 찾아 key(userId)를 알아내고 제거
    let closedUserId = null;
    for (const [id, clientWs] of clients.entries()) {
      if (clientWs === ws) {
        closedUserId = id;
        clients.delete(id);
        break;
      }
    }
    if (closedUserId) {
      console.log(`[WebSocket 서버] 클라이언트 연결 끊김: ${closedUserId} (총 ${clients.size}명)`);
    } else {
      // userId 없이 연결되었다가 바로 끊긴 경우 등
      console.log(`[WebSocket 서버] 클라이언트 연결 끊김 (ID 미확인).`);
    }
  });

  // 에러 발생 시 이벤트 핸들러
  ws.on('error', (error) => {
    console.error(`[WebSocket 서버] 클라이언트 ${userId}에서 오류 발생:`, error);
    // 필요시 해당 클라이언트 연결 종료 및 제거 로직 추가
    if (clients.has(userId) && clients.get(userId) === ws) {
        clients.delete(userId);
        console.log(`[WebSocket 서버] 오류로 인해 ${userId} 연결 제거됨.`);
    }
  });

  // 연결 성공 메시지 (선택적)
  ws.send(JSON.stringify({ type: 'info', message: 'WebSocket 서버에 성공적으로 연결되었습니다.' }));
});

// 서버 종료 시 모든 클라이언트 연결 정리 (선택적)
process.on('SIGINT', () => {
  console.log('[WebSocket 서버] 종료 중... 모든 클라이언트 연결을 닫습니다.');
  clients.forEach((ws, userId) => {
    ws.close(1000, '서버가 종료됩니다.');
  });
  wss.close(() => {
    console.log('[WebSocket 서버] 완전히 종료됨.');
    process.exit(0);
  });
});
