import { nativePlatform } from '@ng-native/fabric';

/**
 * What a phone's browser says it is, by platform. A library reads a touch device from the user
 * agent, as Highcharts does, and takes touches as a phone's browser has them where it finds one:
 * its annotations are dragged by a touch, not a mouse that never comes down.
 */
const AGENTS: Readonly<Record<string, string>> = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
};

/** As many fingers as a phone's screen takes. */
const FINGERS = 5;

/**
 * Give `navigator` a phone browser's user agent where it has none a browser would, React
 * Native's having none and Node's being its own, and the fingers its screen takes where it says
 * nothing of them. Answers what takes them away again.
 */
export function installNavigator(): () => void {
  const navigator = (globalThis as unknown as { navigator?: Record<string, unknown> }).navigator;
  if (!navigator) return () => {};
  const agent = navigator['userAgent'];
  const named = typeof agent !== 'string' || !agent.startsWith('Mozilla/');
  const fingered = typeof navigator['maxTouchPoints'] !== 'number';
  // What each was on the navigator itself, put back as it was: a runtime's own user agent that
  // names no browser, or nothing where the prototype's answered.
  const owned = {
    userAgent: Object.getOwnPropertyDescriptor(navigator, 'userAgent'),
    maxTouchPoints: Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints'),
  };
  const define = (name: string, value: unknown) =>
    Object.defineProperty(navigator, name, { configurable: true, enumerable: true, value });
  const giveBack = (name: keyof typeof owned) => {
    const own = owned[name];
    if (own) Object.defineProperty(navigator, name, own);
    else delete navigator[name];
  };
  if (named) define('userAgent', AGENTS[nativePlatform()] ?? AGENTS['ios']);
  if (fingered) define('maxTouchPoints', FINGERS);
  return () => {
    if (named) giveBack('userAgent');
    if (fingered) giveBack('maxTouchPoints');
  };
}
