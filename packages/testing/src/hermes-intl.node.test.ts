/**
 * Hermes, the engine an app runs on, has three of `Intl`'s constructors. Code that builds another
 * one fails on a device, so it fails under `@ng-native/testing/register` the same way, rather than
 * passing on Node's.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const LACKING = [
  'DisplayNames',
  'DurationFormat',
  'ListFormat',
  'Locale',
  'PluralRules',
  'RelativeTimeFormat',
  'Segmenter',
] as const;

test('has none of the Intl constructors Hermes lacks', () => {
  for (const name of LACKING) assert.equal(name in Intl, false, name);
  assert.throws(
    () => new (Intl as unknown as Record<string, new () => unknown>)['RelativeTimeFormat']!(),
    TypeError,
  );
});

test('keeps the ones Hermes has', () => {
  assert.equal(new Intl.NumberFormat('en-GB').format(1234.5), '1,234.5');
  assert.equal(new Intl.Collator('en-GB').compare('a', 'b'), -1);
  assert.equal(new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC' }).format(0), '01/01/1970');
});

/** What `Intl.RelativeTimeFormat` is in a Node run with these `--import`s, in order. */
function relativeTimeFormatWith(imports: string[]): string {
  return execFileSync(
    process.execPath,
    [
      ...imports.flatMap((file) => ['--import', file]),
      '-e',
      'console.log(typeof Intl.RelativeTimeFormat)',
    ],
    // Not as a test of this run's: `register.mjs` would report to it.
    { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } },
  ).trim();
}

test('keeps a polyfill installed before or after it, as an app installs one on a device', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ngn-intl-'));
  try {
    const register = fileURLToPath(new URL('../runner/register.mjs', import.meta.url));
    const polyfill = path.join(dir, 'polyfill.mjs');
    writeFileSync(
      polyfill,
      "if (!('RelativeTimeFormat' in Intl)) Object.assign(Intl, { RelativeTimeFormat: class {} });\n",
    );
    assert.equal(relativeTimeFormatWith([register, polyfill]), 'function', 'installed after');
    writeFileSync(polyfill, 'Object.assign(Intl, { RelativeTimeFormat: class {} });\n');
    assert.equal(relativeTimeFormatWith([polyfill, register]), 'function', 'installed before');
    assert.equal(relativeTimeFormatWith([register]), 'undefined', 'and none without one');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
