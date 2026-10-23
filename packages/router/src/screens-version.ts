import { InjectionToken } from '@angular/core';
import screensPackage from 'react-native-screens/package.json' with { type: 'json' };

/**
 * The app's react-native-screens version, from its own package. Its native half is built from the
 * same package, and Expo pins the version Expo Go carries, so this is the version native reads
 * props with. A token so that a test can stand in another.
 */
export const SCREENS_VERSION = new InjectionToken<string>('SCREENS_VERSION', {
  providedIn: 'root',
  factory: () => screensPackage.version,
});

/**
 * Whether react-native-screens `version` takes a template tab icon only as an `image` with a
 * `template` rendering mode, as 4.29 and later do. Earlier releases take `iconType: 'template'`.
 */
export function screensReadsRenderingModes(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > 4 || (major === 4 && minor >= 29);
}
