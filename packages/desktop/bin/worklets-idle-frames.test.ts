import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const script = readFileSync(
  new URL('../native/core/src/libraries/worklets-idle-frames.js', import.meta.url),
  'utf8',
);

// The installed react-native-worklets' own UI runtime set-up, which the host runs unchanged: each
// is a worklet with no imports, so its compiled module runs as a plain script once `export` goes.
const worklets = path.dirname(
  createRequire(import.meta.url).resolve('react-native-worklets/package.json'),
);
const setUps = [
  ['common/queueMicrotaskPolyfill.js', 'setupQueueMicrotask'],
  ['uiRuntime/requestAnimationFrame.js', 'setupRequestAnimationFrame'],
  ['uiRuntime/setTimeoutPolyfill.js', 'setupSetTimeout'],
  ['common/setImmediatePolyfill.js', 'setupSetImmediate'],
  ['common/setIntervalPolyfill.js', 'setupSetInterval'],
].map(([file, name]) => {
  const source = readFileSync(path.join(worklets, 'lib', 'module', 'runLoop', file!), 'utf8');
  assert.match(source, new RegExp(`^export function ${name}\\(`, 'm'), `${file} sets up ${name}`);
  return `${source.replace(/^export function /m, 'function ')}\n${name}();`;
});

type Frame = (ts: number) => void;

/**
 * A UI runtime with the host's bindings (the display link's `__nativeRequestAnimationFrame`, and
 * Hermes' job queue), set up by the library's code in the order its initializers run.
 */
function uiRuntime() {
  const native: Frame[] = [];
  const jobs: (() => void)[] = [];
  const clock = { now: 0 };
  const global = vm.createContext({
    __nativeRequestAnimationFrame: (callback: Frame) => native.push(callback),
    __drainMicrotasks: () => jobs.splice(0).forEach((job) => job()),
    HermesInternal: { enqueueJob: (job: () => void) => jobs.push(job) },
    performance: { now: () => clock.now },
  }) as Record<string, unknown>;
  const call = (name: string, ...args: unknown[]) =>
    (global[name] as (...args: unknown[]) => unknown)(...args);
  return {
    global,
    native,
    call,
    setUp: () => setUps.forEach((source) => vm.runInContext(source, global)),
    install: () => vm.runInContext(script, global),
    // The host's display link: one frame at `ts`, running what asked for it.
    frame: (ts: number) => {
      clock.now = ts;
      native.splice(0).forEach((callback) => callback(ts));
    },
  };
}

describe('worklets-idle-frames over the installed react-native-worklets', () => {
  it('parks the loop after a frame that queued nothing, and wakes it when a frame is asked for', () => {
    const ui = uiRuntime();
    ui.setUp();
    ui.install();
    // One frame runs as it installs; after a frame that queued nothing, the loop's request for the
    // next one is held: no frame is asked of the host.
    ui.frame(8);
    ui.frame(16);
    assert.equal(ui.native.length, 0);

    const seen: number[] = [];
    ui.call('requestAnimationFrame', (ts: number) => seen.push(ts));
    assert.equal(ui.native.length, 1);
    ui.frame(32);
    assert.deepEqual(seen, [32]);
    // An animation asking for frame after frame keeps the loop running.
    const again = (ts: number) => {
      seen.push(ts);
      if (seen.length < 4) ui.call('requestAnimationFrame', again);
    };
    ui.call('requestAnimationFrame', again);
    ui.frame(48);
    ui.frame(64);
    ui.frame(80);
    assert.deepEqual(seen, [32, 48, 64, 80]);
    ui.frame(96);
    assert.equal(ui.native.length, 0);
  });

  it('runs a timeout through frames until it is due, then parks', () => {
    const ui = uiRuntime();
    ui.setUp();
    ui.install();
    ui.frame(8);
    ui.frame(16);
    assert.equal(ui.native.length, 0);
    const fired: number[] = [];
    ui.call('setTimeout', () => fired.push(1), 50);
    assert.equal(ui.native.length, 1);
    ui.frame(32);
    ui.frame(48);
    assert.deepEqual(fired, []);
    ui.frame(70);
    assert.deepEqual(fired, [1]);
    ui.frame(86);
    assert.equal(ui.native.length, 0);
  });

  it('wakes for a microtask or the host between frames, and not for a finalizer queued every frame', () => {
    const ui = uiRuntime();
    ui.setUp();
    ui.install();
    ui.frame(8);
    ui.frame(16);
    // Reanimated's mappers ask for a finalizer at the end of every frame, which would never park.
    ui.call('requestAnimationFrameFinalizer', () => {});
    assert.equal(ui.native.length, 0);
    ui.call('queueMicrotask', () => {});
    assert.equal(ui.native.length, 1);
    ui.frame(32);
    ui.frame(48);
    assert.equal(ui.native.length, 0);
    // A gesture's event changed a shared value outside a frame: the host wakes the loop.
    ui.call('__ngnWakeFrames');
    assert.equal(ui.native.length, 1);
  });

  it('works when installed before the runtime sets its queue up, which replaces the functions', () => {
    const ui = uiRuntime();
    ui.install();
    ui.setUp();
    // The loop's first frame runs, then parks.
    assert.equal(ui.native.length, 1);
    ui.frame(16);
    ui.frame(32);
    assert.equal(ui.native.length, 0);
    const seen: number[] = [];
    ui.call('requestAnimationFrame', (ts: number) => seen.push(ts));
    assert.equal(ui.native.length, 1);
    ui.frame(48);
    assert.deepEqual(seen, [48]);
  });

  it('installs once, so a second evaluation does not wrap the wrappers', () => {
    const ui = uiRuntime();
    ui.setUp();
    ui.install();
    const request = ui.global.requestAnimationFrame;
    ui.install();
    assert.equal(ui.global.requestAnimationFrame, request);
  });
});
