/**
 * Takes from `Intl` the constructors Hermes, the engine an app runs on, does not have. Hermes has
 * `Intl.Collator`, `Intl.DateTimeFormat` and `Intl.NumberFormat`; Node has these as well, so code
 * that builds one of them passes its tests and then throws `TypeError: undefined cannot be used as
 * a constructor` on a device. Without them here, it throws the same `TypeError` in the test.
 *
 * A setup file of `ngNative()`'s unless it is given `intl: 'node'`, and imported by `register.mjs`.
 * Only Node's own are removed: an app's setup files run before this one, and a polyfill one of them
 * installs, as the app's entry file does on a device, stays.
 */
const LACKING = [
  'DisplayNames',
  'DurationFormat',
  'ListFormat',
  'Locale',
  'PluralRules',
  'RelativeTimeFormat',
  'Segmenter',
];

const native = (value) =>
  typeof value === 'function' && Function.prototype.toString.call(value).includes('[native code]');

for (const name of LACKING) if (native(Intl[name])) delete Intl[name];
