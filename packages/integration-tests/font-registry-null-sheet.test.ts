/**
 * `FontRegistry.loadSheet()` says so in development when it is given a null sheet, as `loadFonts()`
 * does. Its own file because the warning is said once per process, and
 * `missing-style-sheet-warnings.test.ts` spends it through `loadFonts()`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FontRegistry } from '@ng-native/expo/fonts';

/** Runs `body` with `__DEV__` as given and `console.warn` captured, restoring both. */
async function warnings(
  dev: boolean | undefined,
  body: () => unknown,
  ngDev = true,
): Promise<string[]> {
  const global = globalThis as { __DEV__?: boolean; ngDevMode?: unknown };
  const hadNgDev = 'ngDevMode' in global;
  const previousNgDev = global.ngDevMode;
  const hadDev = '__DEV__' in global;
  const previousDev = global.__DEV__;
  const warn = console.warn;
  const said: string[] = [];
  console.warn = (...args: unknown[]) => void said.push(args.map(String).join(' '));
  try {
    if (dev === undefined) delete global.__DEV__;
    else global.__DEV__ = dev;
    global.ngDevMode = ngDev;
    await body();
  } finally {
    console.warn = warn;
    if (hadNgDev) global.ngDevMode = previousNgDev;
    else delete global.ngDevMode;
    if (hadDev) global.__DEV__ = previousDev;
    else delete global.__DEV__;
  }
  return said.filter((message) => message.startsWith('[angular-native]'));
}

describe('FontRegistry.loadSheet() given a null sheet', () => {
  it('says nothing in a release build, or for a sheet or undefined', async () => {
    const registry = new FontRegistry(null);
    assert.deepEqual(await warnings(false, () => registry.loadSheet(null)), []);
    assert.deepEqual(await warnings(undefined, () => registry.loadSheet(null), false), []);
    assert.deepEqual(await warnings(true, () => registry.loadSheet({}, undefined)), []);
  });

  it('warns once in development', async () => {
    const registry = new FontRegistry(null);
    const said = await warnings(true, async () => {
      await registry.loadSheet(null);
      await registry.loadSheet({}, null);
    });
    assert.equal(said.length, 1, said.join('\n'));
    assert.match(said[0]!, /a null sheet was given to loadFonts\(\) or loadSheet\(\)/);
  });
});
