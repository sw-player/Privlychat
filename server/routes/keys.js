// server/routes/keys.js
const express = require('express');
const router = express.Router();

const keyStore = new Map(); 
const boxKeyStore = new Map();

// 기존 X3DH 라우트 (필요 없다면 삭제 가능)
router.post('/register', (req, res) => {
  const { userId, identityKey, signedPreKey, oneTimePreKeys } = req.body;
  if (!userId || !identityKey || !signedPreKey || !oneTimePreKeys) {
    return res.status(400).json({ error: '잘못된 요청입니다. X3DH 키 번들 정보가 누락되었습니다.' });
  }
  keyStore.set(userId, { identityKey, signedPreKey, oneTimePreKeys, ts: Date.now() });
  console.log(`[서버] X3DH 키 번들 등록: ${userId}`);
  res.json({ success: true, message: `${userId}의 X3DH 키 번들이 등록되었습니다.` });
});

router.get('/:userId', (req, res) => {
  const bundle = keyStore.get(req.params.userId);
  if (!bundle) {
    return res.status(404).json({ error: `${req.params.userId}의 X3DH 키 번들을 찾을 수 없습니다.` });
  }
  const { identityKey, signedPreKey, oneTimePreKeys } = bundle;
  console.log(`[서버] X3DH 키 번들 조회: ${req.params.userId}`);
  res.json({ identityKey, signedPreKey, oneTimePreKeys });
});

// crypto_box 공개키 등록 라우트
router.post('/register_box_key', (req, res) => {
  const { userId, publicKey } = req.body;
  if (!userId || !publicKey) {
    return res.status(400).json({ error: 'userId와 publicKey는 필수입니다.' });
  }
  boxKeyStore.set(userId, publicKey);
  // === 상세 로그 추가 ===
  console.log(`[SERVER /register_box_key] Registered key for ${userId}.`);
  console.log(`  Key: ${publicKey.slice(0,15)}...`);
  console.log(`  Current boxKeyStore size: ${boxKeyStore.size}`);
  console.log(`  Current boxKeyStore keys:`, Array.from(boxKeyStore.keys()));
  // ======================
  res.status(201).json({ message: `${userId}의 crypto_box 공개키가 성공적으로 등록되었습니다.` });
});

// crypto_box 공개키 조회 라우트
router.get('/box_key/:userId', (req, res) => {
  const userId = req.params.userId;
  // === 상세 로그 추가 ===
  console.log(`\n[SERVER /box_key/:userId] Request for key for: '${userId}'`);
  console.log(`  Current boxKeyStore (size: ${boxKeyStore.size}):`, Array.from(boxKeyStore.keys()));
  // ======================
  const publicKey = boxKeyStore.get(userId);

  if (!publicKey) {
    console.error(`  [SERVER ERROR /box_key/:userId] Key NOT FOUND for '${userId}'.`);
    return res.status(404).json({ error: `${userId}의 crypto_box 공개키를 찾을 수 없습니다.` });
  }
  console.log(`  [SERVER /box_key/:userId] Found key for '${userId}': ${publicKey.slice(0,15)}...`);
  res.status(200).json({ userId: userId, publicKey: publicKey });
});

module.exports = router;
