// The watch link is an iOS module, and its Android half does not compile against this React Native.
module.exports = {
  dependencies: {
    'react-native-watch-connectivity': { platforms: { android: null } },
  },
};
