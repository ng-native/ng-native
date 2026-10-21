/**
 * A `transition` a script writes, inline or in a `<style>` it makes, as the spec the engine runs:
 * what the build's compiler makes of one in a stylesheet, `finishTransition` in
 * `packages/metro/css/properties.cjs`, keyed by the props each property sets.
 *
 * The shorthand is the whole spec, and clears any timing a longhand laid over the last one. Each
 * longhand is a part on its own, as the engine lays a rule's timing over a spec: the property list
 * with no time of its own, and the first duration, delay or curve over every property in it.
 *
 * ponytail: a longhand's list pairs only its first entry with every property. Pair each entry
 * with its property if a script is seen writing `transition-duration: 1s, 2s`.
 */

/** The props a property sets, which are the names the engine sees change. */
export type PropsOf = (property: string) => readonly string[];

/** What a curve keyword is, as the four control points the engine eases by. */
const EASINGS: Readonly<Record<string, readonly number[]>> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

/** The timing the engine lays over a spec, by the longhand that sets it. */
const TIMING_KEYS: Readonly<Record<string, string>> = {
  transitionDuration: '$transitionDuration',
  transitionDelay: '$transitionDelay',
  transitionTimingFunction: '$transitionEasing',
};

const TIME = /^[+-]?(\d*\.)?\d+(ms|s)$/i;

/** `225ms` or `.2s` in milliseconds. */
const milliseconds = (time: string): number =>
  /ms$/i.test(time) ? parseFloat(time) : Math.round(parseFloat(time) * 1000);

/**
 * A curve: a keyword or `cubic-bezier()`.
 *
 * ponytail: `steps()` is eased as `ease`, as no curve can step. Step the engine's interpolation
 * if a library is seen to tick a clock hand with one.
 */
function easing(text: string): readonly number[] {
  const named = EASINGS[text.toLowerCase()];
  if (named) return named;
  const [, points] = /^cubic-bezier\(([^)]*)\)$/i.exec(text) ?? [];
  const numbers = points?.split(',').map(Number);
  return numbers?.length === 4 && numbers.every(Number.isFinite) ? numbers : EASINGS['ease']!;
}

/** A list written with commas, each entry its words: a function's commas are its own. */
function entries(text: string): string[][] {
  return text.split(/,(?![^(]*\))/).map((entry) =>
    entry
      .trim()
      .split(/\s+(?![^(]*\))/)
      .filter(Boolean),
  );
}

/** What one property transitions as, by the props it sets: `all` is itself to the engine. */
function keysOf(property: string, propsOf: PropsOf): readonly string[] {
  const name = property.toLowerCase();
  if (name === 'none' || name.startsWith('--')) return [];
  return name === 'all' ? ['all'] : propsOf(name);
}

/** `transition` written whole: the spec, and no timing of a longhand laid over it. */
export function transitionOf(value: unknown, propsOf: PropsOf): Record<string, unknown> {
  const cleared = { $transitionDuration: null, $transitionDelay: null, $transitionEasing: null };
  if (value == null || value === '') return { $transition: null, ...cleared };
  const spec: Record<string, unknown> = {};
  for (const words of entries(String(value))) {
    const times = words.filter((word) => TIME.test(word));
    const curve = words.find((word) => !TIME.test(word) && (word in EASINGS || word.includes('(')));
    const property = words.find((word) => !TIME.test(word) && word !== curve) ?? 'all';
    const timing = {
      duration: times[0] ? milliseconds(times[0]) : 0,
      delay: times[1] ? milliseconds(times[1]) : 0,
      easing: easing(curve ?? 'ease'),
    };
    for (const key of keysOf(property, propsOf)) spec[key] = timing;
  }
  return { $transition: spec, ...cleared };
}

/** A longhand, by its name in camel case, as the part of the spec it is; nothing for another. */
export function transitionPart(
  key: string,
  value: unknown,
  propsOf: PropsOf,
): Record<string, unknown> | undefined {
  const text = value == null ? '' : String(value).trim();
  if (key === 'transitionProperty') {
    if (!text) return { $transition: null };
    const spec: Record<string, unknown> = {};
    const timing = { duration: 0, delay: 0, easing: EASINGS['ease'] };
    for (const [property] of entries(text)) {
      for (const each of keysOf(property ?? '', propsOf)) spec[each] = timing;
    }
    return { $transition: spec };
  }
  const timing = TIMING_KEYS[key];
  if (!timing) return undefined;
  const [first = ''] = entries(text).map((words) => words.join(' '));
  if (!first) return { [timing]: null };
  if (key === 'transitionTimingFunction') return { [timing]: easing(first) };
  return { [timing]: TIME.test(first) ? milliseconds(first) : 0 };
}
