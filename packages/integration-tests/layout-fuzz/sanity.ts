/**
 * Hand-written cases both sides must agree on: plain flex that Yoga and Chrome lay out the same.
 * A run checks them first, so a harness that drifts is caught before it reports engine bugs.
 */
import type { Case, CaseNode, Declaration } from './case.ts';

const box = (css: string, ...children: CaseNode[]): CaseNode => ({
  declarations: css
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const colon = d.indexOf(':');
      return [d.slice(0, colon).trim(), d.slice(colon + 1).trim()] as Declaration;
    }),
  children,
});

const leaf = (width: number, height: number, more = '') =>
  box(`width: ${width}px; height: ${height}px; ${more}`);

export const SANITY: Record<string, Case> = {
  'column of two': {
    seed: 0,
    root: box('display: flex; width: 300px; height: 200px', leaf(50, 40), leaf(60, 30)),
  },
  'row with a gap': {
    seed: 0,
    root: box(
      'display: flex; flex-direction: row; gap: 10px; width: 300px',
      leaf(50, 40),
      leaf(60, 30),
    ),
  },
  'padding, border and margin': {
    seed: 0,
    root: box(
      'display: flex; padding: 10px 5px; border-width: 3px; width: 200px; height: 200px',
      leaf(50, 40, 'margin: 7px 2px 0 11px'),
      leaf(60, 30, 'border-left-width: 4px; padding-top: 6px'),
    ),
  },
  'growing in a row': {
    seed: 0,
    root: box(
      'display: flex; flex-direction: row; width: 300px; height: 50px',
      leaf(50, 40, 'flex-grow: 1'),
      leaf(60, 30, 'flex-grow: 2'),
    ),
  },
  'centred and spaced': {
    seed: 0,
    root: box(
      'display: flex; flex-direction: row; justify-content: space-between; align-items: center; width: 300px; height: 100px',
      leaf(50, 40),
      leaf(60, 30),
      leaf(20, 20),
    ),
  },
  'absolute at insets': {
    seed: 0,
    root: box(
      'display: flex; width: 300px; height: 200px; padding: 10px',
      leaf(50, 40),
      leaf(60, 30, 'position: absolute; top: 15px; left: 25px'),
    ),
  },
  'percentage width': {
    seed: 0,
    root: box('display: flex; width: 300px; height: 200px', leaf(50, 40, 'width: 50%')),
  },
  'text wrapping in a column': {
    seed: 0,
    root: box('display: flex; width: 50px', { ...box('padding: 5px'), text: 'xx xxx' }),
  },
  'shrinking in a row': {
    seed: 0,
    root: box(
      'display: flex; flex-direction: row; width: 100px; height: 50px',
      leaf(80, 40, 'flex-shrink: 1'),
      leaf(60, 30, 'flex-shrink: 1'),
    ),
  },
  'a right-to-left row with a percentage gap': {
    seed: 0,
    root: box(
      'display: flex; flex-direction: row; direction: rtl; column-gap: 10%; width: 300px; height: 50px',
      leaf(50, 40, 'margin-left: 5px'),
      leaf(60, 30),
    ),
  },
};
