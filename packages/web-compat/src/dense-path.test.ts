/**
 * A path denser than the points it is drawn across, thinned for the native drawing to the lowest
 * and highest point of each column one point wide.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { thinnedPath } from './dense-path.ts';

/** A noisy line of `count` points from x 0 to `width`, the same every time. */
function line(count: number, width: number): [number, number][] {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: count }, (_, at) => [
    Math.round((at / (count - 1)) * width * 100) / 100,
    Math.round((50 + 30 * Math.sin(at / 50) + (random() - 0.5) * 40) * 100) / 100,
  ]);
}

const written = (points: readonly [number, number][]) =>
  points.map(([x, y], at) => `${at ? 'L' : 'M'} ${x} ${y}`).join(' ');

/** The points a path goes through, by its numbers. */
const pointsOf = (d: string): [number, number][] => {
  const numbers = d.match(/-?[\d.]+/g)!.map(Number);
  return Array.from({ length: numbers.length / 2 }, (_, at) => [
    numbers[2 * at]!,
    numbers[2 * at + 1]!,
  ]);
};

describe('a dense path thinned for the native drawing', () => {
  it('keeps the lowest and highest point of each column, and where the line starts and ends', () => {
    const points = line(5000, 300);
    const d = thinnedPath(written(points), 1);
    const kept = pointsOf(d);
    assert.ok(kept.length <= 2 * 300 + 4, `${kept.length} points`);
    assert.deepEqual(kept[0], points[0]);
    assert.deepEqual(kept.at(-1), points.at(-1));
    assert.equal(d.match(/M/g)!.length, 1, 'one line still');
    // In every column the line reaches as low and as high as it did.
    const reach = (all: readonly [number, number][]) => {
      const columns = new Map<number, [number, number]>();
      for (const [x, y] of all) {
        const column = Math.floor(x);
        const [low, high] = columns.get(column) ?? [y, y];
        columns.set(column, [Math.min(low, y), Math.max(high, y)]);
      }
      return columns;
    };
    assert.deepEqual(reach(kept), reach(points));
    // The points kept are in the order they were written.
    assert.ok(kept.every((point, at) => at === 0 || point[0] >= kept[at - 1]![0]));
  });

  it('thins to columns as narrow as a point is drawn, under a scale', () => {
    const points = line(5000, 300);
    const halves = pointsOf(thinnedPath(written(points), 2));
    assert.ok(halves.length > 2 * 300 + 4 && halves.length <= 2 * 600 + 4, `${halves.length}`);
  });

  it('keeps an area one shape: its top across, its bottom back, and its close', () => {
    const top = line(3000, 200);
    const d = `${written(top)} L 200 100 L 0 100 Z`;
    const thinned = thinnedPath(d, 1);
    assert.equal(thinned.match(/M/g)!.length, 1);
    assert.ok(thinned.endsWith('L 200 100 L 0 100 Z'), thinned.slice(-40));
    assert.ok(pointsOf(thinned).length < 1000);
  });

  it('draws as written what is short, curved, relative, or not made much shorter', () => {
    const short = written(line(100, 300));
    assert.equal(thinnedPath(short, 1), short);
    const curved = `${written(line(3000, 300))} C 1 2 3 4 5 6`;
    assert.equal(thinnedPath(curved, 1), curved);
    const relative = written(line(3000, 300)).replace(/L/g, 'l');
    assert.equal(thinnedPath(relative, 1), relative);
    // Sparse: a point to every few columns.
    const sparse = written(line(400, 3000));
    assert.equal(thinnedPath(sparse, 1), sparse);
  });
  it('draws as written a line from where a closed run started, which it cannot write', () => {
    const d = `${written(line(3000, 300))} Z L 5 5`;
    assert.equal(thinnedPath(d, 1), d);
    assert.equal(
      thinnedPath(`L 1 1 ${written(line(3000, 300)).slice(1)}`, 1),
      `L 1 1 ${written(line(3000, 300)).slice(1)}`,
    );
  });

  it('thins a line whose points after its move are lines with no L of their own', () => {
    const points = line(3000, 300);
    const d = `M ${points.map(([x, y]) => `${x} ${y}`).join(' ')}`;
    const thinned = thinnedPath(d, 1, 300);
    assert.ok(thinned.length < d.length / 2, `thinned to ${thinned.length} of ${d.length}`);
  });
});
