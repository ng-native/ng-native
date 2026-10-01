import {
  InjectionToken,
  Service,
  computed,
  effect,
  inject,
  signal,
  type Signal,
  untracked,
} from '@angular/core';
import { type PlayerState } from '@ng-native/expo/player';
import { audioPlayer } from '@ng-native/expo/audio';

export interface Track {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  /** The artwork's colour: the app draws its own covers. */
  readonly colour: string;
  readonly source: number;
}

const SOURCES = [
  require('./assets/tone-a.wav') as number,
  require('./assets/tone-b.wav') as number,
  require('./assets/tone-c.wav') as number,
];

export const TRACKS: readonly Track[] = [
  ['So What', 'Miles Davis', '#1d4ed8'],
  ['Naima', 'John Coltrane', '#b45309'],
  ['Blue in Green', 'Bill Evans', '#0f766e'],
  ['Feeling Good', 'Nina Simone', '#be123c'],
  ['Summertime', 'Ella Fitzgerald', '#7c3aed'],
  ['Take Five', 'Dave Brubeck', '#15803d'],
  ['Round Midnight', 'Thelonious Monk', '#334155'],
  ['Moanin', 'Art Blakey', '#c2410c'],
].map(([title, artist, colour], i) => ({
  id: `t${i + 1}`,
  title: title!,
  artist: artist!,
  colour: colour!,
  source: SOURCES[i % SOURCES.length]!,
}));

/** m:ss, as a player shows elapsed and remaining time. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Where a drag across the scrubber lands, as seconds into the track, clamped to its length. */
export function seekTarget(x: number, width: number, duration: number): number {
  if (width <= 0 || duration <= 0) return 0;
  return Math.min(duration, Math.max(0, (x / width) * duration));
}

/** The next index in the queue: in order, or wrapping round with repeat. Null at the end. */
export function nextIndex(index: number, length: number, repeat: boolean): number | null {
  if (index + 1 < length) return index + 1;
  return repeat ? 0 : null;
}

/** Previous: to the start of this track when it is more than a few seconds in, as players do. */
export function previousIndex(index: number, elapsed: number): number {
  return elapsed > 3 || index === 0 ? index : index - 1;
}

/** The slice of `audioPlayer()` the app drives. */
export interface TrackPlayer {
  readonly state: Signal<PlayerState>;
  replace(source: number): void;
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  setVolume(volume: number): void;
}

/** How the app gets a player: `expo-audio` in the app, a fake in a test, which has no audio. */
export const TRACK_PLAYER = new InjectionToken<(initial: number) => TrackPlayer>('TRACK_PLAYER', {
  providedIn: 'root',
  factory: () => (initial: number) => {
    const player = audioPlayer(initial, { timeUpdate: 0.25 });
    return {
      state: player.state,
      replace: (source) => player.native.replace(source),
      play: () => player.native.play(),
      pause: () => player.native.pause(),
      seekTo: (seconds) => void player.native.seekTo(seconds),
      setVolume: (volume) => {
        player.native.volume = volume;
      },
    };
  },
});

/** The one queue and player the library, the mini player and the full player share. */
@Service()
export class Playback {
  private readonly player = inject(TRACK_PLAYER)(TRACKS[0]!.source);
  readonly index = signal<number | null>(null);
  readonly repeat = signal(false);
  readonly volume = signal(1);

  readonly track = computed(() => {
    const index = this.index();
    return index === null ? null : TRACKS[index]!;
  });
  readonly state = this.player.state;
  readonly playing = computed(() => this.state().playing);
  private readonly ended = computed(() => this.state().ended);

  constructor() {
    // A finished record hands on to the next, as a queue does.
    effect(() => {
      if (this.ended()) untracked(() => this.next());
    });
  }

  playTrack(index: number): void {
    this.index.set(index);
    this.player.replace(TRACKS[index]!.source);
    this.player.play();
  }

  toggle(): void {
    if (this.index() === null) return this.playTrack(0);
    if (this.playing()) this.player.pause();
    else this.player.play();
  }

  next(): void {
    const index = this.index();
    if (index === null) return;
    const next = nextIndex(index, TRACKS.length, this.repeat());
    if (next === null) this.player.pause();
    else this.playTrack(next);
  }

  previous(): void {
    const index = this.index();
    if (index === null) return;
    const previous = previousIndex(index, this.state().currentTime);
    if (previous === index) this.player.seekTo(0);
    else this.playTrack(previous);
  }

  seek(seconds: number): void {
    this.player.seekTo(seconds);
  }

  setVolume(volume: number): void {
    this.volume.set(volume);
    this.player.setVolume(volume);
  }
}
