/**
 * Hermes, the engine an app runs on, has three of `Intl`'s constructors. Code that builds another
 * one fails on a device, so it fails in a test the same way, rather than passing on Node's.
 */
import { expect, test } from 'vitest';

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
  for (const name of LACKING) expect(name in Intl, name).toBe(false);
  expect(
    () => new (Intl as unknown as Record<string, new () => unknown>)['RelativeTimeFormat']!(),
  ).toThrow(TypeError);
});

test('keeps the ones Hermes has', () => {
  expect(new Intl.NumberFormat('en-GB').format(1234.5)).toBe('1,234.5');
  expect(new Intl.Collator('en-GB').compare('a', 'b')).toBe(-1);
  expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC' }).format(0)).toBe('01/01/1970');
});
