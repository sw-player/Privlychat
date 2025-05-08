// client/src/App.js
import React, { useEffect, useRef } from 'react'; // useRef import 추가
import './App.css';
import sodium from 'libsodium-wrappers';

import { generateCryptoBoxKeyPair, registerPublicKey, fetchPublicKey } from './crypto/crypto_box_keys';
import { encryptMessage, decryptMessage } from './crypto/crypto_box_message';

export default function App() {
  const effectRan = useRef(false); // 이중 실행 방지용 ref

  useEffect(() => {
    // 개발 모드에서 StrictMode로 인해 두 번 실행되는 것을 방지
    if (process.env.NODE_ENV === 'development' && effectRan.current) {
      return;
    }

    const runCryptoOperations = async () => {
      try {
        await sodium.ready; // sodium 라이브러리 로드 대기 (가장 먼저)
        console.log("Sodium 라이브러리 로드 및 설정 시작.");

        const aliceId = 'alice_box_strict_fixed'; // ID를 바꿔서 서버에 새롭게 등록되도록 함
        const bobId = 'bob_box_strict_fixed';

        // --- 1. Alice 키 생성 및 공개키 서버 등록 ---
        console.log(`\n--- ${aliceId} 키 생성 및 등록 ---`);
        const aliceKeys = await generateCryptoBoxKeyPair();
        console.log(`${aliceId} 키 쌍 생성 완료:`);
        console.log(`  Alice Public Key (Base64): ${aliceKeys.publicKey.slice(0,15)}...`);
        await registerPublicKey(aliceId, aliceKeys.publicKey);

        // --- 2. Bob 키 생성 및 공개키 서버 등록 ---
        console.log(`\n--- ${bobId} 키 생성 및 등록 ---`);
        const bobKeys = await generateCryptoBoxKeyPair();
        console.log(`${bobId} 키 쌍 생성 완료:`);
        console.log(`  Bob Public Key (Base64): ${bobKeys.publicKey.slice(0,15)}...`);
        await registerPublicKey(bobId, bobKeys.publicKey);

        // --- 3. Alice가 Bob에게 메시지 전송 ---
        console.log(`\n--- ${aliceId}가 ${bobId}에게 메시지 전송 ---`);
        const messageToBob = `Hello ${bobId}! from ${aliceId} at ${new Date().toLocaleTimeString()}`;
        console.log(`Alice 원본 메시지: "${messageToBob}"`);

        const bobPublicKeyForAlice = await fetchPublicKey(bobId);
        console.log(`${bobId}의 공개키를 서버에서 가져옴: ${bobPublicKeyForAlice.slice(0,15)}...`);

        const encryptedMsgToBob = await encryptMessage(
          messageToBob,
          bobPublicKeyForAlice,
          aliceKeys.privateKey
        );
        console.log("Alice가 암호화한 메시지 (to Bob):");
        console.log(`  Ciphertext (Base64): ${encryptedMsgToBob.ciphertextB64.slice(0,30)}...`);
        console.log(`  Nonce (Base64): ${encryptedMsgToBob.nonceB64}`);

        // --- 4. Bob이 Alice로부터 메시지 수신 및 복호화 ---
        console.log(`\n--- ${bobId}이 ${aliceId}로부터 메시지 수신 및 복호화 ---`);
        const alicePublicKeyForBob = await fetchPublicKey(aliceId);
        console.log(`${aliceId}의 공개키를 서버에서 가져옴: ${alicePublicKeyForBob.slice(0,15)}...`);

        const decryptedMsgByBob = await decryptMessage(
          encryptedMsgToBob.ciphertextB64,
          encryptedMsgToBob.nonceB64,
          alicePublicKeyForBob,
          bobKeys.privateKey
        );
        console.log(`Bob이 복호화한 메시지: "${decryptedMsgByBob}"`);

        if (decryptedMsgByBob !== messageToBob) {
          throw new Error("Bob의 메시지 복호화 검증 실패!");
        }

        // --- 5. Bob이 Alice에게 응답 메시지 전송 ---
        console.log(`\n--- ${bobId}이 ${aliceId}에게 응답 메시지 전송 ---`);
        const messageToAlice = `Hi ${aliceId}! I got your message. Sent at ${new Date().toLocaleTimeString()}`;
        console.log(`Bob 원본 메시지: "${messageToAlice}"`);

        const encryptedMsgToAlice = await encryptMessage(
          messageToAlice,
          alicePublicKeyForBob,
          bobKeys.privateKey
        );
        console.log("Bob이 암호화한 메시지 (to Alice):");
        console.log(`  Ciphertext (Base64): ${encryptedMsgToAlice.ciphertextB64.slice(0,30)}...`);
        console.log(`  Nonce (Base64): ${encryptedMsgToAlice.nonceB64}`);

        // --- 6. Alice가 Bob으로부터 메시지 수신 및 복호화 ---
        console.log(`\n--- ${aliceId}가 ${bobId}로부터 메시지 수신 및 복호화 ---`);
        const decryptedMsgByAlice = await decryptMessage(
          encryptedMsgToAlice.ciphertextB64,
          encryptedMsgToAlice.nonceB64,
          bobPublicKeyForAlice, // Bob이 보냈으므로 Bob의 공개키 사용
          aliceKeys.privateKey
        );
        console.log(`Alice가 복호화한 메시지: "${decryptedMsgByAlice}"`);

        if (decryptedMsgByAlice !== messageToAlice) {
          throw new Error("Alice의 메시지 복호화 검증 실패!");
        }

        console.log("\n\n🎉 crypto_box를 사용한 메시지 교환 성공! 🎉");

      } catch (error) {
        console.error("\n\n💥 테스트 중 오류 발생: 💥", error);
        if (error.cause) { // 혹시 cause가 있다면 출력
            console.error("오류 원인:", error.cause);
        }
      }
    };

    runCryptoOperations();

    // 개발 모드에서 첫 실행 후 플래그 설정
    if (process.env.NODE_ENV === 'development') {
      effectRan.current = true;
    }

    // 클린업 함수 (필요하다면 여기에 작성)
    return () => {
      // console.log("useEffect cleanup ran");
      // effectRan.current = false; // 컴포넌트가 완전히 언마운트 후 재마운트될 때 다시 실행되도록 하려면
    };
  }, []); // 빈 의존성 배열

  return (
    <div className="App">
      <h1>Libsodium crypto_box 데모</h1>
      <p>브라우저 콘솔에서 상세한 로그를 확인하세요.</p>
    </div>
  );
}