/**
 * `react-native-worklets` where there is no UI-thread runtime: a browser build and a test, which
 * resolve the library here (`ngNativeWeb()` and `@ng-native/testing`). There is one runtime, so
 * scheduling a function on either calls it at once.
 */
export function scheduleOnRN<A extends unknown[]>(fn: (...args: A) => unknown, ...args: A): void {
  fn(...args);
}

export function scheduleOnUI<A extends unknown[]>(fn: (...args: A) => unknown, ...args: A): void {
  fn(...args);
}

export function runOnUISync<A extends unknown[], R>(fn: (...args: A) => R, ...args: A): R {
  return fn(...args);
}

export function runOnJS<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return fn;
}

export function runOnUI<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return fn;
}

export function isWorkletFunction(_value: unknown): boolean {
  return false;
}
