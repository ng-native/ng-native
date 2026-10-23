/**
 * Every app entry point stops `watchConditions` as its app is destroyed.
 *
 * `watchConditions` subscribes to the device's size, colour scheme and accessibility settings, and
 * returns the function that unsubscribes. When Android recreates the activity, a font scale change
 * for one, a new app mounts and the old one is destroyed with its surface. An entry point that drops
 * the returned function leaves the old app's subscriptions running, resolving conditions for an
 * engine nothing shows.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (file: string) => readFileSync(`${root}${file}`, 'utf8');

const ENTRY_POINTS = [
  'template/src/main.ts',
  'packages/nx/files/src/main.ts',
  'packages/schematics/files/src/main.ts',
  ...readdirSync(`${root}examples`)
    .map((example) => `examples/${example}/src/main.ts`)
    .filter((file) => {
      try {
        return read(file).includes('watchConditions(');
      } catch {
        return false;
      }
    }),
];

/** The entry points the docs show in full, each in a code block that mounts an app. */
const GUIDES = [
  'apps/documentation/src/content/guide/manual-setup.md',
  'apps/documentation/src/content/packages/platform/bootstrapping.md',
];

/**
 * Whether each `watchConditions(app.engine)` in `source` keeps its stop function in a constant
 * that is handed to `app.applicationRef.onDestroy`.
 */
function stopsEachWatch(source: string): string | undefined {
  const calls = [...source.matchAll(/^(.*)watchConditions\(app\.engine\b/gm)];
  if (calls.length === 0) return 'never calls watchConditions(app.engine)';
  for (const [line, before] of calls) {
    const kept = /^\s*const (\w+) = $/.exec(before);
    if (!kept) return `drops what watchConditions returns: ${line.trim()}`;
    if (!source.includes(`app.applicationRef.onDestroy(${kept[1]});`)) {
      return `never passes ${kept[1]} to app.applicationRef.onDestroy`;
    }
  }
  return undefined;
}

describe("an app's entry point", () => {
  it('finds the examples that watch conditions', () => {
    assert.ok(ENTRY_POINTS.length > 6, ENTRY_POINTS.join(', '));
  });

  for (const file of ENTRY_POINTS) {
    it(`stops watching conditions as its app is destroyed, in ${file}`, () => {
      assert.equal(stopsEachWatch(read(file)), undefined);
    });
  }

  for (const file of GUIDES) {
    it(`is shown stopping its watch in ${file}`, () => {
      const blocks = read(file).match(/```ts\n[\s\S]*?```/g) ?? [];
      const entry = blocks.find(
        (block) => block.includes('mount(') && block.includes('watchConditions('),
      );
      assert.ok(entry, `${file} shows no entry point`);
      assert.equal(stopsEachWatch(entry), undefined);
    });
  }

  it('reports a watch whose stop function is dropped', () => {
    assert.match(stopsEachWatch('  watchConditions(app.engine);\n') ?? '', /drops/);
    assert.match(
      stopsEachWatch('  const stop = watchConditions(app.engine);\n') ?? '',
      /never passes stop/,
    );
  });
});
