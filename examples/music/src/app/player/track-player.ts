import { InjectionToken, signal, type Signal } from '@angular/core';
import { type PlayerState } from '@ng-native/expo/player';
import { audioPlayer } from '@ng-native/expo/audio';

/** The slice of `audioPlayer()`'s player that `Playback` actually drives. */
export interface TrackPlayer {
  readonly state: Signal<PlayerState>;
  replace(source: number): void;
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  setLoop(loop: boolean): void;
}

/**
 * How `Playback` gets a player, so it is not wired to `audioPlayer()` directly.
 *
 * `audioPlayer()` throws when `expo-audio` is not installed (see player.ts) rather than handing
 * back a player that quietly does nothing, which is right for a device missing a module but wrong
 * for a test: `expo-audio` is never installed under Vitest, so a test that renders a screen with a
 * mini player would fail before it got anywhere near what it meant to check. `app.test.ts`
 * provides `fakeTrackPlayer` through this token instead of touching `expo-audio` at all.
 */
export const TRACK_PLAYER = new InjectionToken<(initial: number) => TrackPlayer>('TRACK_PLAYER', {
  providedIn: 'root',
  factory: () => fromAudioPlayer,
});

function fromAudioPlayer(initial: number): TrackPlayer {
  const player = audioPlayer(initial, { timeUpdate: 0.5 });
  return {
    state: player.state,
    replace: (source) => player.native.replace(source),
    play: () => player.native.play(),
    pause: () => player.native.pause(),
    seekTo: (seconds) => void player.native.seekTo(seconds),
    setLoop: (loop) => {
      player.native.loop = loop;
    },
  };
}

/**
 * A `TrackPlayer` with no audio behind it, built on a real Angular signal so `computed()` and
 * `effect()` in `Playback` still see every change - just driven by `play()`/`pause()`/`seekTo()`
 * calls directly rather than by anything a decoder reports.
 */
export function fakeTrackPlayer(_initial: number): TrackPlayer {
  const state = signal<PlayerState>({
    playing: false,
    status: 'readyToPlay',
    currentTime: 0,
    duration: 8,
    muted: false,
    volume: 1,
    ended: false,
  });
  return {
    state: state.asReadonly(),
    replace: () => state.update((s) => ({ ...s, currentTime: 0, ended: false })),
    play: () => state.update((s) => ({ ...s, playing: true, ended: false })),
    pause: () => state.update((s) => ({ ...s, playing: false })),
    seekTo: (seconds) => state.update((s) => ({ ...s, currentTime: seconds })),
    setLoop: () => {},
  };
}
