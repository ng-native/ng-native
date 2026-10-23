/**
 * The in-memory history behind `PlatformLocation`. No Angular needed, no device.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { NativePlatformLocation, type LinkSource } from '../router/src/native-platform-location.ts';

describe('native platform location', () => {
  let location: NativePlatformLocation;
  let popped: unknown[];

  beforeEach(() => {
    location = new NativePlatformLocation();
    popped = [];
    location.onPopState((event) => popped.push(event.state));
  });

  it('starts at the root with one entry', () => {
    assert.equal(location.pathname, '/');
  });

  it('pushes and reports the new url', () => {
    location.pushState({ id: 1 }, '', '/users/1');
    assert.equal(location.href, '/users/1');
    assert.equal(location.pathname, '/users/1');
    assert.deepEqual(location.getState(), { id: 1 });
  });

  it('splits search and hash out of the pathname', () => {
    location.pushState(null, '', '/search?q=native#results');
    assert.equal(location.pathname, '/search');
    assert.equal(location.search, '?q=native');
    assert.equal(location.hash, '#results');
  });

  it('reads a url with only a query as the root path', () => {
    location.pushState(null, '', '?tab=2');
    assert.equal(location.pathname, '/');
    assert.equal(location.search, '?tab=2');
  });

  it('replaces without growing the stack', () => {
    location.pushState(null, '', '/a');
    location.replaceState({ replaced: true }, '', '/b');

    assert.equal(location.href, '/b');
    assert.deepEqual(location.getState(), { replaced: true });
  });

  it('emits popstate on back so the router follows the native gesture', () => {
    location.pushState({ step: 1 }, '', '/a');
    location.pushState({ step: 2 }, '', '/b');

    location.back();

    assert.equal(location.href, '/a');
    assert.deepEqual(popped, [{ step: 1 }], 'the router is told, with the restored state');
  });

  it('goes forward again after going back', () => {
    location.pushState(null, '', '/a');
    location.back();
    location.forward();

    assert.equal(location.href, '/a');
    assert.equal(popped.length, 2);
  });

  it('discards forward entries once a new push happens', () => {
    location.pushState(null, '', '/a');
    location.pushState(null, '', '/b');
    location.back();
    location.pushState(null, '', '/c');

    assert.equal(location.href, '/c');
    location.forward();
    assert.equal(location.href, '/c', 'nothing to go forward to');
  });

  it('ignores a historyGo past either end rather than throwing', () => {
    location.pushState(null, '', '/a');

    location.historyGo(-5);
    assert.equal(location.href, '/a', 'out of range is a no-op');
    location.historyGo(5);
    assert.equal(location.href, '/a');
    assert.deepEqual(popped, []);
  });

  it('rewinds to an earlier entry without a popstate, keeping the ones ahead as forward', () => {
    location.pushState({ step: 1 }, '', '/a');
    location.pushState({ step: 2 }, '', '/b');
    location.pushState({ step: 3 }, '', '/a');

    location.ɵrewind(2);
    assert.equal(location.href, '/a');
    assert.deepEqual(location.getState(), { step: 1 });
    assert.deepEqual(popped, [], 'the router is on that url already');
    location.forward();
    assert.equal(location.href, '/b');
  });

  it('ignores a rewind past the start, or forward', () => {
    location.pushState(null, '', '/a');
    location.pushState(null, '', '/b');
    location.back();

    location.ɵrewind(2);
    assert.equal(location.href, '/a');
    location.ɵrewind(-1);
    assert.equal(location.href, '/a');
  });

  it('stops notifying once a listener unsubscribes', () => {
    const stop = location.onPopState(() => popped.push('second'));
    stop();
    location.pushState(null, '', '/a');
    location.back();

    assert.deepEqual(popped, [null], 'only the listener still subscribed');
  });
});

/**
 * Deep links. The source is structural, so the history stays authoritative and the router never
 * meets `DeepLinks` itself - which is also what lets these run without a platform under them.
 */
describe('deep links', () => {
  let listener: ((url: string) => void) | null;
  let source: LinkSource;

  beforeEach(() => {
    listener = null;
    source = {
      initialUrl: () => '/users/7',
      subscribe: (fn) => {
        listener = fn;
        return () => (listener = null);
      },
    };
  });

  it('opens on the url the app was launched with', () => {
    const location = new NativePlatformLocation(source);
    assert.equal(location.pathname, '/users/7');
  });

  it('starts at the root when the app was launched normally', () => {
    const location = new NativePlatformLocation({ ...source, initialUrl: () => null });
    assert.equal(location.pathname, '/');
  });

  /** A link that arrives while running has to reach the router, which only listens to popstate. */
  it('navigates to a link that arrives while running', () => {
    const location = new NativePlatformLocation(source);
    const popped: string[] = [];
    location.onPopState(() => popped.push(location.pathname));

    listener!('/settings');

    assert.equal(location.pathname, '/settings');
    assert.deepEqual(popped, ['/settings'], 'the router follows through popstate');
  });

  it('leaves a link that arrives on the entry it is already on alone', () => {
    const location = new NativePlatformLocation(source);
    const popped: string[] = [];
    location.onPopState(() => popped.push(location.pathname));

    listener!('/users/7');

    assert.deepEqual(popped, [], 'no navigation, so no duplicate entry to go back through');
  });
});
