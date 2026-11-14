import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const script = readFileSync(
  new URL('../native/core/src/libraries/worklets-idle-frames.js', import.meta.url),
  'utf8',
);

/**
 * A UI runtime as react-native-worklets sets one up: its requestAnimationFrame queue, flushed by a
 * loop that asks the host for the next frame at the end of every frame.
 */
function uiRuntime() {
  const native: ((ts: number) => void)[] = [];
  // The native binding is there from the runtime's creation; the queue comes with its set-up.
  const global: Record<string, unknown> = {
    __nativeRequestAnimationFrame: (callback: (ts: number) => void) => native.push(callback),
  };
  let queued: ((ts: number) => void)[] = [];
  const finalizers: (() => void)[] = [];
  const loop = (ts: number) => {
    const run = queued;
    queued = [];
    for (const callback of run) callback(ts);
    finalizers.splice(0).forEach((f) => f());
    (global.__nativeRequestAnimationFrame as (cb: (ts: number) => void) => void)(loop);
  };
  const setUp = () => {
    global.requestAnimationFrame = (callback: (ts: number) => void) => queued.push(callback);
    global.requestAnimationFrameFinalizer = (callback: () => void) => finalizers.push(callback);
    global.queueMicrotask = () => {};
    (global.__nativeRequestAnimationFrame as (cb: (ts: number) => void) => void)(loop);
  };
  return {
    global,
    native,
    setUp,
    install: () => vm.runInNewContext(script, { globalThis: global }),
    // The host's display link: one frame, running what asked for it.
    frame: (ts: number) => native.splice(0).forEach((callback) => callback(ts)),
  };
}

describe('worklets-idle-frames', () => {
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
    (ui.global.requestAnimationFrame as (cb: (ts: number) => void) => void)((ts) => seen.push(ts));
    assert.equal(ui.native.length, 1);
    ui.frame(32);
    assert.deepEqual(seen, [32]);
    // An animation asking for frame after frame keeps the loop running.
    const again = (ts: number) => {
      seen.push(ts);
      if (seen.length < 4)
        (ui.global.requestAnimationFrame as (cb: (ts: number) => void) => void)(again);
    };
    (ui.global.requestAnimationFrame as (cb: (ts: number) => void) => void)(again);
    ui.frame(48);
    ui.frame(64);
    ui.frame(80);
    assert.deepEqual(seen, [32, 48, 64, 80]);
    ui.frame(96);
    assert.equal(ui.native.length, 0);
  });

  it('wakes for a microtask or the host between frames, and not for a finalizer queued every frame', () => {
    const ui = uiRuntime();
    ui.setUp();
    ui.install();
    ui.frame(8);
    ui.frame(16);
    // Reanimated's mappers ask for a finalizer at the end of every frame, which would never park.
    (ui.global.requestAnimationFrameFinalizer as (cb: () => void) => void)(() => {});
    assert.equal(ui.native.length, 0);
    (ui.global.queueMicrotask as (cb: () => void) => void)(() => {});
    assert.equal(ui.native.length, 1);
    ui.frame(32);
    ui.frame(48);
    assert.equal(ui.native.length, 0);
    // A gesture's event changed a shared value outside a frame: the host wakes the loop.
    (ui.global.__ngnWakeFrames as () => void)();
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
    (ui.global.requestAnimationFrame as (cb: (ts: number) => void) => void)((ts) => seen.push(ts));
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
