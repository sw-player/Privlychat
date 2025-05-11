// client/src/crypto/crypto_box_keys.js
import sodium from 'libsodium-wrappers';

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
  // 서버의 공개키 등록 엔드포인트 (예시)
  // 실제 서버 구현에 맞게 URL과 요청 본문을 수정해야 합니다.
  const response = await fetch('https://privlychat.netlify.app/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, publicKey: publicKeyB64 }), // 서버에서 받을 필드명에 맞추세요.
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`공개키 등록 실패: ${response.status} ${errorBody}`);
  }
  console.log(`${userId}의 공개키 서버에 등록 요청 완료.`);
  // 필요하다면 서버 응답을 반환하거나 처리할 수 있습니다.
  // return response.json();
}

/**
 * 서버에서 특정 사용자의 공개키를 가져옵니다.
 * 서버는 userId에 해당하는 공개키를 반환해야 합니다.
 * @param {string} userId 공개키를 가져올 사용자 ID
 * @returns {Promise<string>} Base64로 인코딩된 공개키
 */
export async function fetchPublicKey(userId) {
  // 서버의 공개키 조회 엔드포인트 (예시)
  // 실제 서버 구현에 맞게 URL을 수정해야 합니다.
  const response = await fetch(`https://privlychat.netlify.app/${userId}`);
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`${userId}의 공개키 조회 실패: ${response.status} ${errorBody}`);
  }
  const data = await response.json();
  // 서버가 { publicKey: "base64_string" } 형태로 반환한다고 가정합니다.
  // 실제 서버 응답 구조에 맞게 publicKeyB64를 추출하세요.
  if (!data.publicKey) {
      throw new Error(`${userId}의 공개키 데이터 형식이 잘못되었습니다. 'publicKey' 필드가 필요합니다.`);
  }
  return data.publicKey;
}
