// server/app.js
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const cors = require('cors'); // cors 모듈 import

const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const keysRouter = require('./routes/keys'); // 사용자님의 keys.js 라우터

const app = express();

// CORS 설정 정의
// 실제 배포된 Netlify 클라이언트 주소와 필요한 경우 개발/미리보기 주소를 whitelist에 추가합니다.
const whitelist = [
  process.env.CLIENT_URL_PRODUCTION, // 예: https://privlychat.netlify.app (Netlify 환경변수로 설정 권장)
  process.env.CLIENT_URL_PREVIEW     // 예: https://내-netlify-미리보기-URL.netlify.app (필요시)
];
// 로컬 개발 환경에서는 localhost:3000 (React 개발 서버)을 허용 목록에 추가합니다.
if (process.env.NODE_ENV !== 'production') {
  whitelist.push('http://localhost:3000');
}

const corsOptions = {
  origin: function (origin, callback) {
    // origin이 whitelist에 있거나, origin이 제공되지 않은 요청(예: Postman, 서버 간 요청)은 허용합니다.
    if (whitelist.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      console.warn(`CORS: Origin '${origin}' not allowed.`); // 허용되지 않은 origin 로깅
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // 허용할 HTTP 메소드
  allowedHeaders: ['Content-Type', 'Authorization'], // 허용할 요청 헤더 (필요에 따라 'Authorization' 등 추가)
  optionsSuccessStatus: 200 // 일부 레거시 브라우저 호환성
  // credentials: true, // 만약 쿠키나 인증 헤더를 주고받아야 한다면 true로 설정하고,
                      // origin을 '*'로 설정할 수 없습니다. 특정 도메인을 명시해야 합니다.
};

// 모든 요청에 대해 CORS 미들웨어 적용 (라우터 설정보다 먼저!)
app.use(cors(corsOptions));

// 기본 미들웨어 설정
app.use(logger('dev'));
app.use(express.json()); // body-parser 대신 express에 내장된 기능 사용
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'))); // 정적 파일 제공 (필요한 경우)

// Health 체크 엔드포인트 (배포 환경에서 서비스 상태 확인용)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// API 라우터 설정
app.use('/', indexRouter); // 기본 Express 생성기 라우트 (필요에 따라 사용)
app.use('/users', usersRouter); // 기본 Express 생성기 라우트 (필요에 따라 사용)
app.use('/keys', keysRouter);   // 사용자님의 키 관련 API 라우트

// ... (오류 처리 미들웨어 등 Express 기본 설정 유지) ...

module.exports = app;