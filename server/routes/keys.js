// server/routes/keys.js
const express = require('express');
const router = express.Router();

// 메모리 기반 키 저장소 (개발용)
const keyStore = new Map(); // 기존 X3DH 키 번들 저장용
const boxKeyStore = new Map(); // crypto_box 공개키 저장용 << 새로 추가

/**
 * POST /keys/register
 * (기존 X3DH 키 번들 등록 라우트 - 변경 없음)
 * body: { userId, identityKey, signedPreKey, oneTimePreKeys }
 */
router.post('/register', (req, res) => {
  const { userId, identityKey, signedPreKey, oneTimePreKeys } = req.body;
  if (!userId || !identityKey || !signedPreKey || !oneTimePreKeys) {
    return res.status(400).json({ error: '잘못된 요청입니다. X3DH 키 번들 정보가 누락되었습니다.' });
  }
  // 사용자별 키 번들 저장
  keyStore.set(userId, { identityKey, signedPreKey, oneTimePreKeys, ts: Date.now() });
  console.log(`[서버] X3DH 키 번들 등록: ${userId}`);
  res.json({ success: true, message: `${userId}의 X3DH 키 번들이 등록되었습니다.` });
});

/**
 * GET /keys/:userId
 * (기존 X3DH 공개키 번들 조회 라우트 - 변경 없음)
 * – 등록된 공개키 번들 조회 (개인키는 제외)
 */
router.get('/:userId', (req, res) => {
  const bundle = keyStore.get(req.params.userId);
  if (!bundle) {
    return res.status(404).json({ error: `${req.params.userId}의 X3DH 키 번들을 찾을 수 없습니다.` });
  }
  const { identityKey, signedPreKey, oneTimePreKeys } = bundle;
  console.log(`[서버] X3DH 키 번들 조회: ${req.params.userId}`);
  res.json({ identityKey, signedPreKey, oneTimePreKeys });
});


// ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ crypto_box 공개키 등록 라우트 ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
/**
 * POST /keys/register_box_key
 * crypto_box용 공개키를 등록합니다.
 * body: { userId: string, publicKey: string (Base64) }
 */
router.post('/register_box_key', (req, res) => {
  const { userId, publicKey } = req.body;

  if (!userId || !publicKey) {
    return res.status(400).json({ error: 'userId와 publicKey는 필수입니다.' });
  }

  // crypto_box 공개키 저장
  boxKeyStore.set(userId, publicKey);
  console.log(`[서버] crypto_box 공개키 등록: ${userId}, 공개키: ${publicKey.slice(0,20)}...`);

  res.status(201).json({ message: `${userId}의 crypto_box 공개키가 성공적으로 등록되었습니다.` });
});

// ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ crypto_box 공개키 조회 라우트 ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
/**
 * GET /keys/box_key/:userId
 * crypto_box용 공개키를 조회합니다.
 * response: { userId: string, publicKey: string (Base64) }
 */
router.get('/box_key/:userId', (req, res) => {
  const userId = req.params.userId;
  const publicKey = boxKeyStore.get(userId);

  if (!publicKey) {
    return res.status(404).json({ error: `${userId}의 crypto_box 공개키를 찾을 수 없습니다.` });
  }

  console.log(`[서버] crypto_box 공개키 조회: ${userId}. 반환: ${publicKey.slice(0,20)}...`);
  // 클라이언트의 `fetchPublicKey` 함수가 기대하는 형식으로 응답합니다.
  res.status(200).json({ userId: userId, publicKey: publicKey });
});
// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ crypto_box 라우트 추가 완료 ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

module.exports = router;