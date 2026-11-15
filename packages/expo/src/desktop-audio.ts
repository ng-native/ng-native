/**
 * expo-audio over the desktop host's `NgNativeAudio`, for `audioPlayer` and `audioRecorder` on
 * macOS. A TurboModule cannot hand back expo-audio's shared objects, so the host keeps players and
 * recorders by id, and these classes stand in for `AudioPlayer` and `AudioRecorder` over them:
 * the same members, and the same events, which arrive as `ngNativeAudio` with the id they are for.
 */
import { assetUri, desktopHost, type DesktopHost } from './desktop-host.ts';

type ExpoAudio = typeof import('expo-audio');
type AudioStatus = import('expo-audio').AudioStatus;
type RecorderState = import('expo-audio').RecorderState;
type PermissionResponse = import('expo-audio').PermissionResponse;

interface AudioHost {
  createPlayer(uri: string | null, updateIntervalMs: number | null): string;
  replace(id: string, uri: string | null): void;
  release(id: string): void;
  play(id: string): void;
  pause(id: string): void;
  seekTo(id: string, seconds: number): Promise<void>;
  setPlaybackRate(id: string, rate: number): void;
  setVolume(id: string, volume: number): void;
  setMuted(id: string, muted: boolean): void;
  setLoop(id: string, loop: boolean): void;
  status(id: string): AudioStatus | null;
  getRecordingPermissionsAsync(): Promise<PermissionResponse>;
  requestRecordingPermissionsAsync(): Promise<PermissionResponse>;
  setAudioModeAsync(mode: unknown): Promise<void>;
  setIsAudioActiveAsync(active: boolean): Promise<void>;
  createRecorder(options: unknown): string;
  prepareToRecordAsync(id: string, options: unknown): Promise<void>;
  record(id: string): void;
  pauseRecording(id: string): void;
  stopRecording(id: string): Promise<void>;
  recorderStatus(id: string): RecorderState | null;
  releaseRecorder(id: string): void;
}

/** What `ngNativeAudio` carries. */
interface AudioEvent {
  readonly type: string;
  readonly id: string;
  readonly status: unknown;
}

const NO_STATUS = {
  playing: false,
  isLoaded: false,
  isBuffering: false,
  currentTime: 0,
  duration: 0,
} as AudioStatus;

/** Listens to the host's events of `type` for the object `id`, as a shared object's listener. */
function listenFor(
  host: DesktopHost<AudioHost>,
  type: string,
  id: string,
  listener: (status: never) => void,
): { remove(): void } {
  return host.listen('ngNativeAudio', (body) => {
    const event = body as AudioEvent | null;
    if (event?.type === type && event.id === id) listener(event.status as never);
  });
}

/** expo-audio's slice that `audioPlayer` and `audioRecorder` use, or null with no NgNativeAudio. */
export function desktopAudio(): ExpoAudio | null {
  const host = desktopHost<AudioHost>('NgNativeAudio');
  if (!host) return null;
  const native = host.module;

  class AudioPlayer {
    readonly id: string;
    #volume = 1;
    #muted = false;
    #loop = false;
    #rate = 1;

    constructor(source: unknown, updateInterval?: number) {
      this.id = native.createPlayer(assetUri(source), updateInterval ?? null);
    }

    get currentStatus(): AudioStatus {
      return native.status(this.id) ?? { ...NO_STATUS, id: this.id };
    }
    get playing(): boolean {
      return this.currentStatus.playing;
    }
    get paused(): boolean {
      return !this.playing;
    }
    get isLoaded(): boolean {
      return this.currentStatus.isLoaded;
    }
    get isBuffering(): boolean {
      return this.currentStatus.isBuffering;
    }
    get currentTime(): number {
      return this.currentStatus.currentTime;
    }
    get duration(): number {
      return this.currentStatus.duration;
    }
    get isAudioSamplingSupported(): boolean {
      return false;
    }
    get shouldCorrectPitch(): boolean {
      return true;
    }
    get volume(): number {
      return this.#volume;
    }
    set volume(volume: number) {
      this.#volume = Math.min(1, Math.max(0, volume));
      native.setVolume(this.id, this.#volume);
    }
    get muted(): boolean {
      return this.#muted;
    }
    set muted(muted: boolean) {
      this.#muted = muted;
      native.setMuted(this.id, muted);
    }
    get loop(): boolean {
      return this.#loop;
    }
    set loop(loop: boolean) {
      this.#loop = loop;
      native.setLoop(this.id, loop);
    }
    get playbackRate(): number {
      return this.#rate;
    }
    set playbackRate(rate: number) {
      this.setPlaybackRate(rate);
    }

    play(): void {
      native.play(this.id);
    }
    pause(): void {
      native.pause(this.id);
    }
    replace(source: unknown): void {
      native.replace(this.id, assetUri(source));
    }
    seekTo(seconds: number): Promise<void> {
      return native.seekTo(this.id, seconds);
    }
    setPlaybackRate(rate: number): void {
      this.#rate = Math.min(2, Math.max(0, rate));
      native.setPlaybackRate(this.id, this.#rate);
    }
    /** No samples on macOS: `isAudioSamplingSupported` is false. */
    setAudioSamplingEnabled(): void {}
    /** No lock screen on macOS. */
    setActiveForLockScreen(): void {}
    updateLockScreenMetadata(): void {}
    clearLockScreenControls(): void {}
    addListener(event: string, listener: (status: never) => void): { remove(): void } {
      return listenFor(host!, event, this.id, listener);
    }
    release(): void {
      native.release(this.id);
    }
    remove(): void {
      this.release();
    }
  }

  class AudioRecorder {
    readonly id: string;

    constructor(options: unknown) {
      this.id = native.createRecorder(options ?? {});
    }

    getStatus(): RecorderState {
      return (
        native.recorderStatus(this.id) ?? {
          canRecord: false,
          isRecording: false,
          durationMillis: 0,
          fileSize: 0,
          mediaServicesDidReset: false,
          url: null,
        }
      );
    }
    get uri(): string | null {
      return this.getStatus().url;
    }
    get isRecording(): boolean {
      return this.getStatus().isRecording;
    }
    get currentTime(): number {
      return this.getStatus().durationMillis / 1000;
    }

    prepareToRecordAsync(options?: unknown): Promise<void> {
      return native.prepareToRecordAsync(this.id, options ?? null);
    }
    record(): void {
      native.record(this.id);
    }
    pause(): void {
      native.pauseRecording(this.id);
    }
    stop(): Promise<void> {
      return native.stopRecording(this.id);
    }
    /** The system's default input: macOS picks it, in System Settings. */
    getAvailableInputs(): [] {
      return [];
    }
    setInput(): void {}
    addListener(event: string, listener: (status: never) => void): { remove(): void } {
      return listenFor(host!, event, this.id, listener);
    }
    release(): void {
      native.releaseRecorder(this.id);
    }
  }

  const permissions = {
    getRecordingPermissionsAsync: () => native.getRecordingPermissionsAsync(),
    requestRecordingPermissionsAsync: () => native.requestRecordingPermissionsAsync(),
    setAudioModeAsync: (mode: unknown) => native.setAudioModeAsync(mode),
    setIsAudioActiveAsync: (active: boolean) => native.setIsAudioActiveAsync(active),
  };
  const audio = {
    ...permissions,
    AudioModule: { ...permissions, AudioPlayer, AudioRecorder },
    createAudioPlayer: (source: unknown, options: { updateInterval?: number } = {}) =>
      new AudioPlayer(source, options.updateInterval),
  };
  return audio as unknown as ExpoAudio;
}
