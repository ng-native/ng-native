/**
 * In a browser build, which defines no `__DEV__`, `ngDevMode` decides whether `loadSheet()` and
 * `loadFonts()` warn about a null sheet. Its own file because the warning is said once per process.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FontRegistry, loadFonts } from '@ng-native/expo/fonts';

/** Runs `body` with `__DEV__` as given and `console.warn` captured, restoring both. */
async function warnings(
  dev: boolean | undefined,
  body: () => unknown,
  ngDev: boolean | null = null,
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
    if (ngDev === null) delete global.ngDevMode;
    else global.ngDevMode = ngDev;
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

describe('a null sheet in a browser build', () => {
  it('is said once when neither __DEV__ nor ngDevMode is defined', async () => {
    const said = await warnings(undefined, async () => {
      await new FontRegistry(null).loadSheet(null);
      await loadFonts(null);
    });
    assert.equal(said.length, 1, said.join('\n'));
  });
});
