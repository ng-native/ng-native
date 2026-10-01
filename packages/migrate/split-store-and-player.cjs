/**
 * 0.3.0 split `@ng-native/expo/store` and `@ng-native/expo/player` into an entry point per native
 * module, so an app installs only the module it uses: each entry point `require`s its module, and
 * Metro fails a build on any `require` it cannot resolve, whether or not the code runs. What both
 * halves share (`Store`, `NativeStore`, `Player`, `PlayerState` and the rest) stays where it was.
 */
const { moveImports } = require('./move-imports.cjs');

const MOVED = {
  '@ng-native/expo/store': {
    Storage: '@ng-native/expo/async-storage',
    SecureStorage: '@ng-native/expo/secure-store',
  },
  '@ng-native/expo/player': {
    audioPlayer: '@ng-native/expo/audio',
    videoPlayer: '@ng-native/expo/video',
  },
};

/** @param {import('./host.cjs').Host} host */
function splitStoreAndPlayer(host) {
  return moveImports(host, MOVED);
}

module.exports = { splitStoreAndPlayer };
