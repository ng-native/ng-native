/**
 * `NgNativeTesting`, this package's native module: on iOS and Android an Expo module, and on macOS
 * the desktop host's TurboModule of the same name, which draws the window in process.
 */
import type { Frame } from './index.ts';

export interface TestingModule {
  /** A PNG, in base64, of the app's window, or of the region of it given in points. */
  capture(region: Frame | null): Promise<string>;
  /** A PNG, in base64, of the part of the window a view covers, found by its tag. */
  captureView(reactTag: number): Promise<string>;
  /** Native view animations on or off: UIKit's on iOS, the animator duration scale on Android. */
  setAnimationsEnabled?(enabled: boolean): Promise<boolean>;
}

/** Where the module may be: the Expo modules, the TurboModules, and the OS the app runs on. */
export interface TestingModuleSources {
  readonly expoModules?: Record<string, unknown>;
  readonly turboModule?: (name: string) => unknown;
  readonly os?: string;
}

/** The module from `sources`, or an error that says what this app is missing. */
export function testingModuleFrom({
  expoModules,
  turboModule,
  os,
}: TestingModuleSources): TestingModule {
  const module = (expoModules?.['NgNativeTesting'] ?? turboModule?.('NgNativeTesting')) as
    TestingModule | undefined | null;
  if (module?.capture) return module;
  throw new Error(missing(os));
}

function missing(os: string | undefined): string {
  const needs = 'This needs the NgNativeTesting native module from @ng-native/testing';
  if (os === 'macos') {
    return (
      `${needs}, which this macOS host does not have. Update @ng-native/desktop, whose host ` +
      'has it from the release that added it.'
    );
  }
  if (os === 'linux') return `${needs}, which the Linux host does not have yet.`;
  return (
    `${needs}, which this build of the app does not have. Rebuild the development build after ` +
    'installing or upgrading @ng-native/testing; Expo Go does not have it. iOS, Android and ' +
    'macOS have it.'
  );
}
