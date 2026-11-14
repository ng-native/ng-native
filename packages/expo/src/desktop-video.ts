/**
 * expo-video over the desktop host's `NgNativeVideo`, for `videoPlayer` on macOS. A TurboModule
 * cannot hand back expo-video's shared objects, so the host keeps players by a number, and this
 * class stands in for `VideoPlayer` over it: the same members, and the same events, which arrive
 * as `ngNativeVideo` with the number they are for. The number is the player's shared-object id
 * too, so `<expo-video [player]="player.id">` commits it and the host's view finds the player.
 */
import { assetUri, desktopHost, type DesktopHost } from './desktop-host.ts';

type ExpoVideo = typeof import('expo-video');
type VideoPlayerStatus = import('expo-video').VideoPlayerStatus;

/** What `state(id)` answers: what the player's getters read. */
interface VideoState {
  readonly status: VideoPlayerStatus;
  readonly playing: boolean;
  readonly currentTime: number;
  readonly duration: number;
  readonly bufferedPosition: number;
  readonly playbackRate: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly loop: boolean;
  readonly preservesPitch: boolean;
  readonly timeUpdateEventInterval: number;
}

interface VideoHost {
  createPlayer(uri: string | null): number;
  replace(id: number, uri: string | null): void;
  release(id: number): void;
  play(id: number): void;
  pause(id: number): void;
  replay(id: number): void;
  seekBy(id: number, seconds: number): void;
  setCurrentTime(id: number, seconds: number): void;
  setPlaybackRate(id: number, rate: number): void;
  setVolume(id: number, volume: number): void;
  setMuted(id: number, muted: boolean): void;
  setLoop(id: number, loop: boolean): void;
  setPreservesPitch(id: number, preserves: boolean): void;
  setTimeUpdateEventInterval(id: number, seconds: number): void;
  state(id: number): VideoState | null;
}

/** What `ngNativeVideo` carries. */
interface VideoEvent {
  readonly type: string;
  readonly id: number;
  readonly payload: unknown;
}

const NO_STATE: VideoState = {
  status: 'idle',
  playing: false,
  currentTime: 0,
  duration: 0,
  bufferedPosition: 0,
  playbackRate: 1,
  volume: 1,
  muted: false,
  loop: false,
  preservesPitch: true,
  timeUpdateEventInterval: 0,
};

/** The uri an expo-video source names: a string, an asset, `{uri}` or `{assetId}`. */
function sourceUri(source: unknown): string | null {
  if (source !== null && typeof source === 'object' && 'assetId' in source && !('uri' in source)) {
    return assetUri((source as { assetId: unknown }).assetId);
  }
  return assetUri(source);
}

/** expo-video's slice that `videoPlayer` uses, or null with no NgNativeVideo. */
export function desktopVideo(): ExpoVideo | null {
  const host: DesktopHost<VideoHost> | null = desktopHost<VideoHost>('NgNativeVideo');
  if (!host) return null;
  const native = host.module;

  class VideoPlayer {
    readonly __expo_shared_object_id__: number;
    readonly isLive = false;
    readonly currentLiveTimestamp = null;
    readonly currentOffsetFromLive = null;
    readonly targetOffsetFromLive = 0;
    readonly allowsExternalPlayback = false;
    readonly isExternalPlaybackActive = false;
    readonly staysActiveInBackground = false;
    readonly showNowPlayingNotification = false;
    readonly keepScreenOnWhilePlaying = false;
    readonly audioMixingMode = 'auto';
    readonly availableVideoTracks = [];
    readonly videoTrack = null;
    readonly availableSubtitleTracks = [];
    readonly subtitleTrack = null;
    readonly availableAudioTracks = [];
    readonly audioTrack = null;

    constructor(source: unknown) {
      this.__expo_shared_object_id__ = native.createPlayer(sourceUri(source));
    }

    get #id(): number {
      return this.__expo_shared_object_id__;
    }
    get #state(): VideoState {
      return native.state(this.#id) ?? NO_STATE;
    }
    get status(): VideoPlayerStatus {
      return this.#state.status;
    }
    get playing(): boolean {
      return this.#state.playing;
    }
    get duration(): number {
      return this.#state.duration;
    }
    get bufferedPosition(): number {
      return this.#state.bufferedPosition;
    }
    get currentTime(): number {
      return this.#state.currentTime;
    }
    set currentTime(seconds: number) {
      native.setCurrentTime(this.#id, seconds);
    }
    get playbackRate(): number {
      return this.#state.playbackRate;
    }
    set playbackRate(rate: number) {
      native.setPlaybackRate(this.#id, rate);
    }
    get volume(): number {
      return this.#state.volume;
    }
    set volume(volume: number) {
      native.setVolume(this.#id, volume);
    }
    get muted(): boolean {
      return this.#state.muted;
    }
    set muted(muted: boolean) {
      native.setMuted(this.#id, muted);
    }
    get loop(): boolean {
      return this.#state.loop;
    }
    set loop(loop: boolean) {
      native.setLoop(this.#id, loop);
    }
    get preservesPitch(): boolean {
      return this.#state.preservesPitch;
    }
    set preservesPitch(preserves: boolean) {
      native.setPreservesPitch(this.#id, preserves);
    }
    get timeUpdateEventInterval(): number {
      return this.#state.timeUpdateEventInterval;
    }
    set timeUpdateEventInterval(seconds: number) {
      native.setTimeUpdateEventInterval(this.#id, seconds);
    }

    play(): void {
      native.play(this.#id);
    }
    pause(): void {
      native.pause(this.#id);
    }
    replay(): void {
      native.replay(this.#id);
    }
    seekBy(seconds: number): void {
      native.seekBy(this.#id, seconds);
    }
    replace(source: unknown): void {
      native.replace(this.#id, sourceUri(source));
    }
    async replaceAsync(source: unknown): Promise<void> {
      this.replace(source);
    }
    /** AVAssetImageGenerator's thumbnails are not on macOS yet. */
    generateThumbnailsAsync(): Promise<never> {
      return Promise.reject(
        new Error('VideoPlayer.generateThumbnailsAsync is not available on macOS'),
      );
    }
    addListener(event: string, listener: (payload: never) => void): { remove(): void } {
      return host!.listen('ngNativeVideo', (body) => {
        const sent = body as VideoEvent | null;
        if (sent?.type === event && sent.id === this.#id) listener(sent.payload as never);
      });
    }
    release(): void {
      native.release(this.#id);
    }
  }

  const video = {
    VideoPlayer,
    createVideoPlayer: (source: unknown) => new VideoPlayer(source),
  };
  return video as unknown as ExpoVideo;
}
