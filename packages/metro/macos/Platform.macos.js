/** React Native's `Platform` in a `macos` bundle: see `desktop-platform.js`. */
import IOSPlatform from 'react-native/Libraries/Utilities/Platform.ios.js';
import { desktopPlatform } from '@ng-native/metro/macos/desktop-platform.js';

export default desktopPlatform(IOSPlatform, 'macos');
