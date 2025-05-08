// client/src/crypto/crypto_box_message.js
import sodium from 'libsodium-wrappers';

/**
 * 메시지를 crypto_box_easy를 사용하여 암호화합니다.
 * @param {string} plaintext 평문 메시지
 * @param {string} recipientPublicKeyB64 수신자의 Base64 인코딩된 공개키
 * @param {string} senderPrivateKeyB64 송신자의 Base64 인코딩된 개인키
 * @returns {Promise<{ciphertextB64: string, nonceB64: string}>} Base64 인코딩된 암호문과 nonce 객체
 */
export async function encryptMessage(plaintext, recipientPublicKeyB64, senderPrivateKeyB64) {
  await sodium.ready;

  const messageBytes = sodium.from_string(plaintext);
  const recipientPublicKeyBytes = sodium.from_base64(recipientPublicKeyB64, sodium.base64_variants.ORIGINAL);
  const senderPrivateKeyBytes = sodium.from_base64(senderPrivateKeyB64, sodium.base64_variants.ORIGINAL);

  const nonceBytes = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);

  const ciphertextBytes = sodium.crypto_box_easy(
    messageBytes,
    nonceBytes,
    recipientPublicKeyBytes,
    senderPrivateKeyBytes
  );

  return {
    ciphertextB64: sodium.to_base64(ciphertextBytes, sodium.base64_variants.ORIGINAL),
    nonceB64: sodium.to_base64(nonceBytes, sodium.base64_variants.ORIGINAL),
  };
}

/**
 * crypto_box_easy로 암호화된 메시지를 복호화합니다.
 * @param {string} ciphertextB64 Base64 인코딩된 암호문
 * @param {string} nonceB64 Base64 인코딩된 nonce
 * @param {string} senderPublicKeyB64 송신자의 Base64 인코딩된 공개키
 * @param {string} recipientPrivateKeyB64 수신자의 Base64 인코딩된 개인키
 * @returns {Promise<string>} 복호화된 평문 메시지
 */
export async function decryptMessage(ciphertextB64, nonceB64, senderPublicKeyB64, recipientPrivateKeyB64) {
  await sodium.ready;

  const ciphertextBytes = sodium.from_base64(ciphertextB64, sodium.base64_variants.ORIGINAL);
  const nonceBytes = sodium.from_base64(nonceB64, sodium.base64_variants.ORIGINAL);
  const senderPublicKeyBytes = sodium.from_base64(senderPublicKeyB64, sodium.base64_variants.ORIGINAL);
  const recipientPrivateKeyBytes = sodium.from_base64(recipientPrivateKeyB64, sodium.base64_variants.ORIGINAL);

  const decryptedBytes = sodium.crypto_box_open_easy(
    ciphertextBytes,
    nonceBytes,
    senderPublicKeyBytes,
    recipientPrivateKeyBytes
  );

  if (decryptedBytes === null) {
    throw new Error('메시지 복호화 실패 (키 또는 암호문이 잘못되었을 수 있습니다).');
  }

  return sodium.to_string(decryptedBytes);
}
