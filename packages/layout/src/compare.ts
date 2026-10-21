import type { Box } from './fixture.ts';

/** Chrome lays out in 64ths of a pixel and the recorder rounds to hundredths. */
const TOLERANCE = 0.05;

/** The first box that differs, as a path and the two boxes, or nothing when the trees agree. */
export function firstDifference(actual: Box, expected: Box, path = 'root'): string | undefined {
  for (let i = 0; i < 4; i++) {
    if (Math.abs((actual[i] as number) - (expected[i] as number)) > TOLERANCE) {
      return `${path}: [${actual.slice(0, 4).join(', ')}], Chrome [${expected.slice(0, 4).join(', ')}]`;
    }
  }
  if (actual[4].length !== expected[4].length) {
    return `${path}: ${actual[4].length} children, Chrome ${expected[4].length}`;
  }
  for (let i = 0; i < expected[4].length; i++) {
    const difference = firstDifference(actual[4][i]!, expected[4][i]!, `${path}.${i}`);
    if (difference) return difference;
  }
  return undefined;
}
