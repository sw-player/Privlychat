const express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const keysRouter = require('./routes/keys');
const cors    = require('cors');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

var app = express();

// 1) CORS 미들웨어를 프리플라이트(OPTIONS) 포함 전역에 적용
app.use(cors({
  origin: 'http://localhost:3000',    // React 개발 서버
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Health 체크
app.get('/health', (req, res) => {
    res.send('OK');
  });

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/keys', keysRouter);

module.exports = app;
