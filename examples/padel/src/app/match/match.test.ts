import { expect, test } from 'vitest';
import { pointLabel, scoreOf, setsWon, type Team } from './match.ts';

const times = (count: number, team: Team): Team[] => Array<Team>(count).fill(team);
const game = (team: Team) => times(4, team);
const games = (count: number, team: Team) => Array.from({ length: count }, () => game(team)).flat();

test('counts 15, 30, 40 and wins the game on the fourth point', () => {
  expect(pointLabel(scoreOf([0]), 0)).toBe('15');
  expect(pointLabel(scoreOf([0, 0, 1]), 0)).toBe('30');
  expect(pointLabel(scoreOf([0, 0, 0]), 0)).toBe('40');
  expect(scoreOf(game(0)).games).toEqual([1, 0]);
});

test('plays deuce and advantage, back to deuce when the other side wins a point', () => {
  const deuce = [...times(3, 0), ...times(3, 1)];
  expect(pointLabel(scoreOf([...deuce, 0]), 0)).toBe('AD');
  expect(pointLabel(scoreOf([...deuce, 0]), 1)).toBe('40');
  const back = scoreOf([...deuce, 0, 1]);
  expect([pointLabel(back, 0), pointLabel(back, 1)]).toEqual(['40', '40']);
  expect(scoreOf([...deuce, 0, 1, 1, 1]).games).toEqual([0, 1]);
});

test('ends a game on the point after deuce with golden point', () => {
  const deuce = [...times(3, 0), ...times(3, 1)];
  expect(scoreOf([...deuce, 1], true).games).toEqual([0, 1]);
});

test('wins a set at 6 by two, or 7-5', () => {
  expect(scoreOf(games(6, 0)).sets).toEqual([[6, 0]]);
  const fiveAll = [...games(5, 0), ...games(5, 1)];
  expect(scoreOf([...fiveAll, ...game(0)]).sets).toEqual([]);
  expect(scoreOf([...fiveAll, ...games(2, 0)]).sets).toEqual([[7, 5]]);
});

test('plays a tiebreak at 6-6, to 7 by two', () => {
  const sixAll = [...games(5, 0), ...games(5, 1), ...game(0), ...game(1)];
  expect(scoreOf(sixAll).tiebreak).toBe(true);
  const tiebreak = scoreOf([...sixAll, ...times(6, 0), ...times(6, 1)]);
  expect(pointLabel(tiebreak, 0)).toBe('6');
  expect(scoreOf([...sixAll, ...times(6, 0), ...times(6, 1), 0, 0]).sets).toEqual([[7, 6]]);
});

test('wins the match at two sets and ignores points after', () => {
  const match = [...games(6, 1), ...games(6, 1)];
  expect(scoreOf(match).winner).toBe(1);
  expect(setsWon(scoreOf(match), 1)).toBe(2);
  expect(scoreOf([...match, 0])).toEqual(scoreOf(match));
});
