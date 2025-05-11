// client/craco.config.js
const webpack = require('webpack');

module.exports = {
  webpack: {
    configure: (webpackConfig, { env, paths }) => {
      // crypto 모듈 polyfill 추가
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback, // 기존 fallback 유지
        "crypto": require.resolve("crypto-browserify"),
        "stream": require.resolve("stream-browserify"),
        "vm": require.resolve("vm-browserify"),
        // "assert": require.resolve("assert/"), // 필요에 따라 추가
        // "http": require.resolve("stream-http"), // 필요에 따라 추가
        // "https": require.resolve("https-browserify"), // 필요에 따라 추가
        // "os": require.resolve("os-browserify/browser"), // 필요에 따라 추가
        // "url": require.resolve("url/") // 필요에 따라 추가
      };

      // Buffer polyfill (필요한 경우)
       webpackConfig.plugins = [
         ...(webpackConfig.plugins || []),
         new webpack.ProvidePlugin({
           Buffer: ['buffer', 'Buffer'],
           process: 'process/browser',
         }),
       ];

      // Node.js core 모듈 polyfill을 위한 다른 설정 (필요 시)
      // webpackConfig.resolve.alias = {
      //   ...webpackConfig.resolve.alias,
      //   // 예: 'path': require.resolve('path-browserify')
      // };

      return webpackConfig;
    },
  },
};