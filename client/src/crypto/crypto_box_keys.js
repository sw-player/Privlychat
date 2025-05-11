// client/src/crypto/crypto_box_keys.js
import sodium from 'libsodium-wrappers';

// API 서버의 기본 URL을 환경 변수에서 가져오거나, 로컬 개발 시 기본값을 사용합니다.
// 이 값은 Netlify 환경 변수 REACT_APP_API_BASE_URL에 설정된
// 실제 배포된 백엔드 서버의 주소 (예: https://내-서버-이름.onrender.com)가 됩니다.
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8888';

/**
 * crypto_box 키 쌍(공개키, 개인키)을 생성합니다.
 * @returns {Promise<{publicKey: string, privateKey: string}>} Base64로 인코딩된 공개키와 개인키 객체
 */
export async function generateCryptoBoxKeyPair() {
  await sodium.ready;
  const { publicKey, privateKey } = sodium.crypto_box_keypair();
  return {
    publicKey: sodium.to_base64(publicKey, sodium.base64_variants.ORIGINAL),
    privateKey: sodium.to_base64(privateKey, sodium.base64_variants.ORIGINAL),
  };
}

/**
 * 사용자의 공개키를 서버에 등록합니다.
 * 서버는 userId와 publicKeyB64를 저장해야 합니다.
 * @param {string} userId 사용자 ID
 * @param {string} publicKeyB64 Base64로 인코딩된 공개키
 */
export async function registerPublicKey(userId, publicKeyB64) {
  // ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ 수정된 부분 ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
  // API_BASE_URL을 사용하여 전체 요청 URL을 구성합니다.
  const response = await fetch(`${API_BASE_URL}/keys/register_box_key`, {
  // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ 수정된 부분 ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, publicKey: publicKeyB64 }),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    // 오류 메시지에 요청 URL을 포함하면 디버깅에 도움이 됩니다.
    throw new Error(`공개키 등록 실패 (${response.status}) URL: ${API_BASE_URL}/keys/register_box_key. 서버 응답: ${errorBody}`);
  }
  console.log(`${userId}의 공개키 서버에 등록 요청 완료 (URL: ${API_BASE_URL}/keys/register_box_key).`);
  // return response.json(); // 필요시
}

/**
 * 서버에서 특정 사용자의 공개키를 가져옵니다.
 * 서버는 userId에 해당하는 공개키를 반환해야 합니다.
 * @param {string} userId 공개키를 가져올 사용자 ID
 * @returns {Promise<string>} Base64로 인코딩된 공개키
 */
export async function fetchPublicKey(userId) {
  // ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ 수정된 부분 ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
  // API_BASE_URL을 사용하고, 경로를 서버 라우트와 일치시킵니다.
  const response = await fetch(`${API_BASE_URL}/keys/box_key/${userId}`);
  // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ 수정된 부분 ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`${userId}의 공개키 조회 실패 (${response.status}) URL: ${API_BASE_URL}/keys/box_key/${userId}. 서버 응답: ${errorBody}`);
  }
  const data = await response.json();
  if (!data.publicKey) {
      throw new Error(`${userId}의 공개키 데이터 형식이 잘못되었습니다. 'publicKey' 필드가 필요합니다. 수신 데이터: ${JSON.stringify(data)}`);
  }
  return data.publicKey;
}
