export type Team = 0 | 1;

export interface Score {
  readonly sets: readonly (readonly [number, number])[];
  readonly games: readonly [number, number];
  readonly points: readonly [number, number];
  readonly tiebreak: boolean;
  readonly winner: Team | null;
}

export const NEW_MATCH: Score = {
  sets: [],
  games: [0, 0],
  points: [0, 0],
  tiebreak: false,
  winner: null,
};

const LABELS = ['0', '15', '30', '40'];

export function scoreOf(points: readonly Team[], goldenPoint = false): Score {
  return points.reduce((score, team) => addPoint(score, team, goldenPoint), NEW_MATCH);
}

export function addPoint(score: Score, team: Team, goldenPoint = false): Score {
  if (score.winner !== null) return score;
  const other = (1 - team) as Team;
  const points = withOne(score.points, team);
  const lead = points[team] - points[other];
  if (score.tiebreak) {
    return points[team] >= 7 && lead >= 2 ? winGame(score, team) : { ...score, points };
  }
  if (points[team] >= 4 && (lead >= 2 || goldenPoint)) return winGame(score, team);
  if (points[0] === 4 && points[1] === 4) return { ...score, points: [3, 3] };
  return { ...score, points };
}

export function pointLabel(score: Score, team: Team): string {
  const own = score.points[team];
  const other = score.points[1 - team];
  if (score.tiebreak) return String(own);
  if (own === 4 && other === 3) return 'AD';
  if (own === 3 && other === 4) return '40';
  return LABELS[own] ?? '0';
}

export function setsWon(score: Score, team: Team): number {
  return score.sets.filter((set) => set[team] > set[1 - team]).length;
}

function winGame(score: Score, team: Team): Score {
  const other = (1 - team) as Team;
  const games = withOne(score.games, team);
  const lead = games[team] - games[other];
  const setOver = score.tiebreak || (games[team] >= 6 && lead >= 2);
  if (!setOver) {
    const tiebreak = games[0] === 6 && games[1] === 6;
    return { ...score, games, points: [0, 0], tiebreak };
  }
  const sets = [...score.sets, games];
  const won = sets.filter((set) => set[team] > set[other]).length;
  return {
    sets,
    games: [0, 0],
    points: [0, 0],
    tiebreak: false,
    winner: won === 2 ? team : null,
  };
}

function withOne(pair: readonly [number, number], team: Team): [number, number] {
  return team === 0 ? [pair[0] + 1, pair[1]] : [pair[0], pair[1] + 1];
}
