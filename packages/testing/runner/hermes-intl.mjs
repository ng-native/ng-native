/**
 * Takes from `Intl` the constructors Hermes, the engine an app runs on, does not have. Hermes has
 * `Intl.Collator`, `Intl.DateTimeFormat` and `Intl.NumberFormat`; Node has the ones below as well,
 * so code that builds one of them passes its tests and then throws `TypeError: undefined cannot be
 * used as a constructor` on a device. Without them here, it throws a `TypeError` in the test too.
 *
 * `ngNative()` runs this ahead of the app's own setup files unless it is given `intl: 'node'`, and
 * `register.mjs` imports it. A polyfill installed after it sees `Intl` as Hermes has it. Only
 * Node's own constructors are removed, so a polyfill installed before it, such as one given to
 * `node --import` ahead of `register.mjs`, stays.
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
