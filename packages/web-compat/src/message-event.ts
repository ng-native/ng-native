import type { Engine } from '@ng-native/fabric';
import { dispatch, newEvent, report } from './events.ts';
import { locationOf, newestLocation } from './page-address.ts';

/**
 * A `message` event on a window, after the task that sent it, as `postMessage` delivers one: its
 * `data`, the `origin` and `source` it came from, and the window's `onmessage` after its listeners.
 */
export function deliverMessage(
  window: object,
  data: unknown,
  origin: string,
  source: unknown,
): void {
  const timer = (globalThis as { setTimeout: (run: () => void, ms: number) => unknown }).setTimeout;
  timer(() => {
    const event = newEvent('message');
    Object.defineProperties(event, {
      data: { value: data, configurable: true },
      origin: { value: origin, configurable: true },
      lastEventId: { value: '', configurable: true },
      source: { value: source, configurable: true },
      ports: { value: Object.freeze([]), configurable: true },
    });
    dispatch(event, [window]);
    const handler = (window as Record<string, unknown>)['onmessage'];
    if (typeof handler !== 'function') return;
    try {
      handler.call(window, event);
    } catch (error) {
      report(error);
    }
  }, 0);
}

/**
 * The origin an app's page is at, or the newest app's for none given: `null` where it has none.
 * The page's own, and not a `location` the runtime had before it.
 */
export const pageOrigin = (engine?: Engine): string =>
  (engine ? locationOf(engine) : newestLocation())?.origin ?? 'null';
