import { Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { Watch, type WatchPayload } from '@ng-native/expo/watch';
import type { Scoreline } from '../live/score-activity.ts';
import { NEW_MATCH, addPoint, pointLabel, setsWon, type Score, type Team } from './match.ts';

export type Source = 'phone' | 'watch' | 'widget';

export interface Rally {
  readonly id: string;
  readonly team: Team;
  readonly source: Source;
  readonly goldenPoint: boolean;
}

export const TEAMS = ['Us', 'Them'] as const;

@Service()
export class MatchStore {
  private readonly watch = inject(Watch);
  private readonly seen = new Set<string>();
  private nextId = 0;

  readonly rallies = signal<readonly Rally[]>([]);
  readonly goldenPoint = signal(false);
  readonly scores = computed(() => {
    let score = NEW_MATCH;
    return this.rallies().map((rally) => (score = addPoint(score, rally.team, rally.goldenPoint)));
  });
  readonly score = computed(() => this.scores().at(-1) ?? NEW_MATCH);

  constructor() {
    this.watch.onMessage((message) => this.fromWatch(message));
    effect(() => {
      const queued = this.watch.userInfo();
      untracked(() => queued.forEach((info) => this.fromWatch(info)));
    });
    effect(() => this.watch.update(forWatch(this.score())));
  }

  point(team: Team, source: Source = 'phone', id = `${source}-${this.nextId++}`): void {
    if (this.score().winner !== null) return;
    const goldenPoint = this.goldenPoint();
    this.rallies.update((rallies) => [...rallies, { id, team, source, goldenPoint }]);
  }

  undo(): void {
    this.rallies.update((rallies) => rallies.slice(0, -1));
  }

  newMatch(): void {
    this.rallies.set([]);
  }

  private fromWatch(message: WatchPayload): WatchPayload {
    // Not `id`: iOS replaces that on a message that wants a reply, so the live copy of a point and
    // the one the watch queued after its reply failed would not match.
    const id = typeof message['rally'] === 'string' ? message['rally'] : null;
    if (id && !this.seen.has(id)) {
      this.seen.add(id);
      if (message['undo'] === true) this.undo();
      else if (message['point'] === 0 || message['point'] === 1) {
        this.point(message['point'], 'watch', id);
      }
    }
    return forWatch(this.score());
  }
}

export function scoreline(score: Score): Scoreline {
  return {
    us: pointLabel(score, 0),
    them: pointLabel(score, 1),
    games: `${score.games[0]}-${score.games[1]}`,
    sets: `${setsWon(score, 0)}-${setsWon(score, 1)}`,
    winner: score.winner === null ? '' : TEAMS[score.winner],
  };
}

export function forWatch(score: Score): WatchPayload {
  return { ...scoreline(score), tiebreak: score.tiebreak };
}
