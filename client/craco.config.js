// client/craco.config.js
module.exports = {
    webpack: {
      configure: (config) => {
        config.resolve.fallback = {
          ...(config.resolve.fallback || {}),
          path: require.resolve('path-browserify'),
          fs: false,
        };
        return config;
      },
    },
  };
  