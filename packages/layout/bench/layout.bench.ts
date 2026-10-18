/**
 * What the layout candidates cost in JavaScript, with the JIT off: Hermes runs bytecode, and V8's
 * optimiser hides the costs that dominate there. Interpreted Node is roughly a seventh of an iOS
 * simulator's time and ranks the same.
 *
 *   pnpm bench
 *
 * It also counts the measurements each grid fixture asks of its items, since on a device each
 * kind of measurement is a commit to read sizes back from.
 */
import { performance } from 'node:perf_hooks';
import { fixtureNames, parseFixture, type FixtureNode } from '../src/fixture.ts';
import { lowerBlocks } from '../src/flow-lowering.ts';
import { layOutWithGrids } from '../src/grid-yoga.ts';
import { layOutGrid, type GridItem } from '@ng-native/fabric';

function time(run: () => void): number {
  for (let i = 0; i < 5; i++) run();
  const samples: number[] = [];
  for (let i = 0; i < 25; i++) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  return samples.sort((a, b) => a - b)[12]!;
}

const item = (style: Record<string, string> = {}): GridItem => ({
  style,
  measure: (width) => ({
    width: typeof width === 'number' ? width : width === 'min' ? 40 : 120,
    height: 24,
  }),
});

const GRIDS: Record<string, { style: Record<string, string>; item?: Record<string, string> }> = {
  'fixed columns': { style: { 'grid-template-columns': '100px 100px 100px 100px' } },
  'repeat(4, 1fr), gap': { style: { 'grid-template-columns': 'repeat(4, 1fr)', gap: '8px' } },
  'auto columns': { style: { 'grid-template-columns': 'auto auto auto auto', gap: '8px' } },
  'minmax(min-content, 1fr)': {
    style: { 'grid-template-columns': 'repeat(4, minmax(min-content, 1fr))', gap: '8px' },
  },
  'auto-fill minmax(80px, 1fr)': {
    style: { 'grid-template-columns': 'repeat(auto-fill, minmax(80px, 1fr))', gap: '8px' },
  },
  'every third spans 2': {
    style: { 'grid-template-columns': 'repeat(4, auto)', gap: '8px' },
    item: { 'grid-column': 'span 2' },
  },
};

console.log('grid algorithm, median ms (no JIT), 360 wide');
console.log(['grid'.padEnd(30), ...[10, 100, 1000].map((n) => `${n} items`.padStart(12))].join(''));
for (const [name, grid] of Object.entries(GRIDS)) {
  const row = [10, 100, 1000].map((count) => {
    const items = Array.from({ length: count }, (_, i) =>
      item(i % 3 === 0 ? grid.item : undefined),
    );
    return time(() => layOutGrid(grid.style, items, { width: 360 }))
      .toFixed(3)
      .padStart(12);
  });
  console.log(name.padEnd(30) + row.join(''));
}

const blocks = (count: number): FixtureNode => ({
  style: { display: 'block', width: '360px' },
  classes: [],
  text: '',
  children: Array.from({ length: count }, () => ({
    style: { display: 'block', margin: '8px 0', height: '24px' },
    classes: [],
    text: '',
    children: [],
  })),
});
console.log('\nflow lowering, median ms (no JIT)');
for (const count of [10, 100, 1000]) {
  const tree = blocks(count);
  console.log(
    `${count} blocks`.padEnd(30) +
      time(() => lowerBlocks(tree))
        .toFixed(3)
        .padStart(12),
  );
}

const needs = { nothing: 0, heights: 0, widths: 0 };
const grids = fixtureNames().filter((name) => name.startsWith('grid/'));
for (const name of grids) {
  const asked = new Set<string>();
  try {
    layOutWithGrids(lowerBlocks(parseFixture(name)), 'strict', (kind) => asked.add(kind));
  } catch {
    continue;
  }
  if (asked.has('min') || asked.has('max')) needs.widths += 1;
  else if (asked.has('height')) needs.heights += 1;
  else needs.nothing += 1;
}
console.log(`\nmeasurements the ${grids.length} grid fixtures need`);
console.log(`  none, one commit:                   ${needs.nothing}`);
console.log(`  heights at a known width:           ${needs.heights}`);
console.log(`  content widths (min or max):        ${needs.widths}`);
