/**
 * Hermes, the engine an app runs on, has three of `Intl`'s constructors. Code that builds another
 * one fails on a device, so it fails under `@ng-native/testing/register` the same way, rather than
 * passing on Node's.
 */
import assert from 'node:assert/strict';
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
