/**
 * A media player's state, as signals.
 *
 * `useVideoPlayer` is not where the player comes from - `createVideoPlayer` gives the same object.
 * What the hook adds is the two things a component needs and cannot otherwise get: the player is
 * released when the component goes, and its state is readable, since the player's own properties
 * are plain mutable fields no template can watch.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Injector, runInInjectionContext } from '@angular/core';
import { watchPlayer, type NativePlayer } from '@ng-native/expo/player';
import { audioPlayer } from '@ng-native/expo/audio';
import { videoPlayer } from '@ng-native/expo/video';

/** Fakes `require`, the same seam `optional()` reaches through on a device or in Node. */
function withModule<T>(id: string, native: unknown, run: () => T): T {
  const host = globalThis as Record<string, unknown>;
  host['require'] = (requested: string) => {
    if (requested !== id) throw new Error(`Cannot find module '${requested}'`);
    return native;
  };
  try {
    return run();
  } finally {
    delete host['require'];
  }
}

const muteOf = ({ muted, volume }: { muted: boolean; volume: number }) => ({ muted, volume });

/** A player that records what was listened to and can emit. */
function player(own: { muted?: boolean; volume?: number } = {}) {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const api = {
    ...own,
    released: false,
    timeUpdateEventInterval: 0,
    addListener(event: string, listener: (payload: never) => void) {
      const list = listeners.get(event) ?? [];
      list.push(listener as (payload: unknown) => void);
      listeners.set(event, list);
      return {
        remove: () =>
          listeners.set(
            event,
            list.filter((one) => one !== listener),
          ),
      };
    },
    release() {
      api.released = true;
    },
    emit(event: string, payload?: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
    listenerCount: () => [...listeners.values()].reduce((total, list) => total + list.length, 0),
  };
  return api;
}

describe('watching a player', () => {
  it('starts idle, because nothing has been loaded yet', () => {
    const { state } = watchPlayer(player());
    assert.equal(state().status, 'idle');
    assert.equal(state().playing, false);
  });

  it("starts with the player's own muted and volume, which no event says until they change", () => {
    assert.deepEqual(muteOf(watchPlayer(player({ muted: true, volume: 0.3 })).state()), {
      muted: true,
      volume: 0.3,
    });
    assert.deepEqual(muteOf(watchPlayer(player()).state()), { muted: false, volume: 1 });
  });

  it('keeps muted and volume across a new source, as the player does', () => {
    const native = player();
    const { state } = watchPlayer(native);
    native.emit('mutedChange', { muted: true });
    native.emit('volumeChange', { volume: 0.5 });
    native.emit('playingChange', { isPlaying: true });
    native.emit('sourceLoad', { duration: 42.5, videoSource: null });

    native.emit('sourceChange');
    assert.deepEqual(state(), {
      status: 'loading',
      playing: false,
      currentTime: 0,
      duration: 0,
      muted: true,
      volume: 0.5,
      ended: false,
    });
  });

  it('follows the events the player emits', () => {
    const native = player();
    const { state } = watchPlayer(native);

    native.emit('statusChange', { status: 'readyToPlay' });
    native.emit('playingChange', { isPlaying: true });
    assert.equal(state().status, 'readyToPlay');
    assert.equal(state().playing, true);
  });

  it('knows how long the video is once its source has loaded', () => {
    // `currentTime / duration` is the progress bar every player draws, and the duration stayed 0.
    const native = player();
    const { state } = watchPlayer(native);
    native.emit('sourceLoad', { duration: 42.5, videoSource: null });
    assert.equal(state().duration, 42.5);
  });

  it('leaves currentTime alone unless a caller asked for progress', () => {
    // `timeUpdate` is off by default in both modules and is the most frequent event either emits.
    // A screen with no progress bar should not be paying for one.
    const native = player();
    watchPlayer(native);
    assert.equal(native.timeUpdateEventInterval, 0);

    const other = player();
    watchPlayer(other, { timeUpdate: 0.5 });
    assert.equal(other.timeUpdateEventInterval, 0.5);
  });

  it('records reaching the end, and forgets it when playing starts again', () => {
    const native = player();
    const { state } = watchPlayer(native);

    native.emit('playToEnd');
    assert.deepEqual([state().ended, state().playing], [true, false]);

    native.emit('playingChange', { isPlaying: true });
    assert.deepEqual([state().ended, state().playing], [false, true]);
  });

  it('starts over when the source changes', () => {
    const native = player();
    const { state } = watchPlayer(native);
    native.emit('statusChange', { status: 'readyToPlay' });
    native.emit('timeUpdate', { currentTime: 30 });

    native.emit('sourceChange', {});
    assert.deepEqual([state().currentTime, state().status], [0, 'loading']);
  });

  it('releases the player when it stops, which is the half a hook does', () => {
    // A player left alive holds its decoder, its audio session and the now-playing controls.
    const native = player();
    const { stop } = watchPlayer(native);
    assert.ok(native.listenerCount() > 0);

    stop();
    assert.equal(native.listenerCount(), 0);
    assert.equal(native.released, true);
  });

  it('is inert with no player at all', () => {
    const { state, stop } = watchPlayer(null as NativePlayer | null);
    assert.equal(state().status, 'idle');
    stop();
  });
});

/**
 * `videoPlayer` and `audioPlayer`: a component's own player, made from a module rather than
 * handed a fake, and released along with the component that made it.
 */
describe('owning a player', () => {
  it('creates a video player through expo-video, and releases it when the component goes', () => {
    const native = player();
    const created: unknown[] = [];
    const expoVideo = {
      createVideoPlayer: (source: unknown) => (created.push(source), native),
    };

    const injector = Injector.create({ providers: [] });
    const owned = withModule('expo-video', expoVideo, () =>
      runInInjectionContext(injector, () => videoPlayer({ uri: 'file://a.mp4' } as never)),
    );

    assert.equal(owned.native, native);
    assert.deepEqual(created, [{ uri: 'file://a.mp4' }]);
    assert.equal(owned.state().status, 'idle');

    injector.destroy();
    assert.equal(native.released, true, 'released along with the component, not left playing');
  });

  it('refuses to create one in Node, where expo-video has nothing to load', () => {
    const injector = Injector.create({ providers: [] });
    assert.throws(
      () => runInInjectionContext(injector, () => videoPlayer({ uri: 'file://a.mp4' } as never)),
      /expo-video has no native module to load in Node/,
    );
  });

  it('creates an audio player through expo-audio, released when the component goes', () => {
    const native = player();
    const created: unknown[] = [];
    const expoAudio = {
      createAudioPlayer: (source: unknown, options: unknown) => (
        created.push([source, options]),
        native
      ),
    };

    const injector = Injector.create({ providers: [] });
    const owned = withModule('expo-audio', expoAudio, () =>
      runInInjectionContext(injector, () => audioPlayer({ uri: 'file://a.mp3' } as never)),
    );

    assert.equal(owned.native, native);
    assert.deepEqual(created, [[{ uri: 'file://a.mp3' }, { updateInterval: undefined }]]);
    assert.equal(owned.state().status, 'idle');

    injector.destroy();
    assert.equal(native.released, true, 'released along with the component, not left playing');
  });

  it('refuses to create one in Node, where expo-audio has nothing to load', () => {
    const injector = Injector.create({ providers: [] });
    assert.throws(
      () => runInInjectionContext(injector, () => audioPlayer({ uri: 'file://a.mp3' } as never)),
      /expo-audio has no native module to load in Node/,
    );
  });

  it("converts timeUpdate, in seconds, to expo-audio's updateInterval, in milliseconds, at creation", () => {
    const native = player();
    const created: unknown[] = [];
    const expoAudio = {
      createAudioPlayer: (source: unknown, options: unknown) => (created.push(options), native),
    };

    const injector = Injector.create({ providers: [] });
    withModule('expo-audio', expoAudio, () =>
      runInInjectionContext(injector, () =>
        audioPlayer({ uri: 'file://a.mp3' } as never, { timeUpdate: 0.5 }),
      ),
    );

    assert.deepEqual(created, [{ updateInterval: 500 }]);
    injector.destroy();
  });

  it("reads an audio player's whole state off its one playbackStatusUpdate event", () => {
    const native = player();
    const expoAudio = { createAudioPlayer: () => native };

    const injector = Injector.create({ providers: [] });
    const owned = withModule('expo-audio', expoAudio, () =>
      runInInjectionContext(injector, () => audioPlayer({ uri: 'file://a.mp3' } as never)),
    );

    native.emit('playbackStatusUpdate', {
      playing: true,
      mute: false,
      duration: 120,
      currentTime: 30,
      isLoaded: true,
      didJustFinish: false,
      error: null,
    });

    assert.deepEqual(
      [
        owned.state().playing,
        owned.state().status,
        owned.state().currentTime,
        owned.state().duration,
      ],
      [true, 'readyToPlay', 30, 120],
    );

    native.emit('playbackStatusUpdate', {
      playing: false,
      mute: false,
      duration: 120,
      currentTime: 120,
      isLoaded: true,
      didJustFinish: true,
      error: null,
    });
    assert.equal(owned.state().ended, true);

    native.emit('playbackStatusUpdate', {
      playing: false,
      mute: false,
      duration: 0,
      currentTime: 0,
      isLoaded: false,
      didJustFinish: false,
      error: 'decoder failed',
    });
    assert.equal(owned.state().status, 'error', 'an error wins over loading');

    injector.destroy();
  });
});
