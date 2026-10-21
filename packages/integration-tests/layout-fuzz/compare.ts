/**
 * Comparing the two layouts of a case, box by box.
 */
import { boxes, type Case } from './case.ts';
import type { Rect } from './pipeline.ts';

/**
 * Chrome lays out in 64ths of a pixel and React Native's Yoga rounds to a 3x screen's pixel
 * grid, so a third of a point on an edge is rounding, and anything past half a point is not.
 */
export const TOLERANCE = 0.5;

export interface Difference {
  readonly box: string;
  /** Which of left, top, width, height differ. */
  readonly fields: readonly ('x' | 'y' | 'w' | 'h' | 'missing')[];
  readonly chrome: Rect;
  readonly pipeline: Rect;
}

const FIELDS = ['x', 'y', 'w', 'h'] as const;

/** Every box whose rectangle differs, in document order. */
export function differences(
  test: Case,
  chrome: Map<string, Rect>,
  pipeline: Map<string, Rect>,
): Difference[] {
  const out: Difference[] = [];
  for (const { name } of boxes(test.root)) {
    const a = chrome.get(name);
    const b = pipeline.get(name);
    if (!a) continue;
    if (!b) {
      // Laid out in Chrome, and never committed.
      out.push({ box: name, fields: ['missing'], chrome: a, pipeline: [NaN, NaN, NaN, NaN] });
      continue;
    }
    const fields = FIELDS.filter((_, i) => Math.abs(a[i]! - b[i]!) > TOLERANCE);
    if (fields.length) out.push({ box: name, fields, chrome: a, pipeline: b });
  }
  return out;
}

const round = (rect: Rect) => `[${rect.map((n) => Math.round(n * 100) / 100).join(', ')}]`;

export function describeDifference(difference: Difference): string {
  return `${difference.box}: Chrome ${round(difference.chrome)}, pipeline ${round(difference.pipeline)}`;
}

export const describeRect = round;
