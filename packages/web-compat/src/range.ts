import type { Engine, EngineNode } from '@ng-native/fabric';
import { disabled } from './activation.ts';
import { domError } from './dom-error.ts';
import { parseFloatingPoint, type Reflecting } from './reflect.ts';
import { engineOf } from './window.ts';

/**
 * `<input type="range">`, as much of one as a library builds a slider on: a value kept between
 * its `min` and `max` on its `step` by HTML's rules, `valueAsNumber`, `stepUp()` and
 * `stepDown()`, and a value moved under a finger dragged across it, with `input` said as it
 * moves and `change` as the finger lifts. A browser draws a control of its own for one; a
 * library hides that and draws its own over it, so nothing is drawn here. Material's slider lays
 * an input over its track and draws the thumb where the input says its value is.
 *
 * `stepUp()`, `stepDown()` and `valueAsNumber` are a number input's too, by the same rules.
 *
 * ponytail: the value runs left to right, in a page written right to left too. Read the
 * element's direction if a slider is laid out that way. A date's or a time's `valueAsNumber` is
 * not read; they answer `NaN`.
 */

const typeOf = (node: EngineNode): string =>
  String((node as Reflecting).getAttribute('type') ?? 'text').toLowerCase();

export const isRange = (node: EngineNode): boolean =>
  node.tag === 'input' && typeOf(node) === 'range';

/** The input types `stepUp()`, `stepDown()` and `valueAsNumber` are for. */
const NUMBERED = new Set(['range', 'number']);

/** The value set on each range by a script or a finger: its dirty value, which bounds move. */
const set = new WeakMap<EngineNode, string>();

const attribute = (node: EngineNode, name: string): number | undefined => {
  const text = (node as Reflecting).getAttribute(name);
  return text === null ? undefined : parseFloatingPoint(text);
};

/** HTML's "valid floating-point number", which a value has to be to be read as one. */
const FLOAT = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/;
const numberOf = (text: string): number | undefined =>
  FLOAT.test(text) ? Number(text) : undefined;

interface Bounds {
  /** Without a bound written, a number input has none: it goes on for ever that way. */
  readonly min: number;
  readonly max: number;
  /** Nothing where `step="any"`: every value between the bounds is allowed. */
  readonly step: number | undefined;
  /** What steps are counted from: the least written, or the value written. */
  readonly base: number;
  /** How many decimal places a value on a step is written to. */
  readonly places: number;
}

const placesOf = (number: number): number => {
  const [, decimals = '', exponent = '0'] =
    /^-?\d*(?:\.(\d+))?(?:e([-+]\d+))?$/.exec(String(number)) ?? [];
  return Math.max(0, decimals.length - Number(exponent));
};

/** An input's step: nothing for `any`, and 1 for one that is no number above 0. */
function stepOf(node: EngineNode): number | undefined {
  const written = (node as Reflecting).getAttribute('step');
  if (written?.toLowerCase() === 'any') return undefined;
  const step = attribute(node, 'step') ?? 0;
  return step > 0 ? step : 1;
}

/** What an input's steps are counted from: its least written, or its value written, or 0. */
function baseOf(node: EngineNode): number {
  const own = (node as Reflecting).getAttribute('value');
  return attribute(node, 'min') ?? numberOf(own ?? '') ?? 0;
}

/**
 * An input's bounds as HTML reads them: a range's are 0 to 100 with none written, and a most
 * under its least is the least, as Chrome has it.
 */
function boundsOf(node: EngineNode): Bounds {
  const range = typeOf(node) === 'range';
  const min = attribute(node, 'min') ?? (range ? 0 : -Infinity);
  const max = attribute(node, 'max') ?? (range ? 100 : Infinity);
  const step = stepOf(node);
  const base = baseOf(node);
  return {
    min,
    max: range ? Math.max(max, min) : max,
    step,
    base,
    places: Math.max(placesOf(step ?? 0), placesOf(base)),
  };
}

/** How many steps a value is from the base, rounded first to what the sum can mean. */
const stepsTo = (value: number, { base, step }: Bounds): number =>
  // 0.35 over 0.1 is 3.4999999999999996, which is three and a half steps.
  Number(((value - base) / step!).toFixed(9));

/** The value a number of steps from the base, written to as many places as the step and base. */
const onStep = (count: number, bounds: Bounds): number =>
  Number((bounds.base + count * bounds.step!).toFixed(Math.min(bounds.places, 100)));

/** A number as a range holds it: within its bounds, and on the nearest step in them. */
function held(value: number, bounds: Bounds): number {
  const { min, max, step } = bounds;
  const kept = Math.min(Math.max(value, min), max);
  if (step === undefined) return kept;
  // Halfway goes up, as HTML has it.
  const count = Math.round(stepsTo(kept, bounds));
  const stepped = onStep(count, bounds);
  if (stepped > max) return onStep(count - 1, bounds);
  return stepped < min ? onStep(count + 1, bounds) : stepped;
}

/** A range's value sanitized, as HTML has it: what is no number is the middle of its bounds. */
function sanitized(node: EngineNode, text: string | null | undefined): string {
  const bounds = boundsOf(node);
  const middle = bounds.min + (bounds.max - bounds.min) / 2;
  return String(held(numberOf(text ?? '') ?? middle, bounds));
}

/** `input.value` of a range: the value set, or the value written, as its bounds keep it. */
export function rangeValue(node: EngineNode): string | undefined {
  if (!isRange(node)) return undefined;
  return sanitized(node, set.get(node) ?? (node as Reflecting).getAttribute('value'));
}

/** Set a range's value, as a script or a finger does. False for an input that is no range. */
export function setRangeValue(node: EngineNode, value: unknown): boolean {
  if (!isRange(node)) return false;
  set.set(node, sanitized(node, value == null ? '' : String(value)));
  return true;
}

/** A form reset, or a value written: the range's value is what is written again. */
export const forgetRangeValue = (node: EngineNode): void => void set.delete(node);

/** The attributes a range's value is kept within. */
const BOUNDS = new Set(['min', 'max', 'step']);

/**
 * An attribute of a range written: one of its bounds, set here so its value is moved within
 * them, as Chrome moves it; or its value, which is the value again in place of one set, as a
 * text field's is. Answers whether the attribute is set already.
 */
export function setRange(node: EngineNode, name: string, value: unknown, engine: Engine): boolean {
  if (!isRange(node)) return false;
  if (name === 'value') {
    forgetRangeValue(node);
    return false;
  }
  if (!BOUNDS.has(name)) return false;
  engine.setProp(node, name, value);
  const was = set.get(node);
  if (was !== undefined) set.set(node, sanitized(node, was));
  return true;
}

/** `input.valueAsNumber`: a range's or a number input's value as a number, and `NaN` for any other. */
export function valueAsNumber(node: EngineNode): number {
  if (!NUMBERED.has(typeOf(node))) return Number.NaN;
  return numberOf(String((node as { value?: unknown }).value ?? '')) ?? Number.NaN;
}

const notNumbered = (what: string) =>
  domError(`This input has no ${what}: it is not a number or a range.`, 'InvalidStateError');

export function setValueAsNumber(node: EngineNode, value: unknown): void {
  const number = Number(value);
  if (number === Infinity || number === -Infinity) {
    throw new TypeError(`The value provided (${number}) is not a finite number.`);
  }
  if (!NUMBERED.has(typeOf(node))) throw notNumbered('number value');
  (node as { value?: unknown }).value = Number.isNaN(number) ? '' : String(number);
}

/**
 * HTML's `stepUp(n)` and `stepDown(n)`, `way` 1 or -1: `n` steps that way from the value, or to
 * the next step that way where it is off one, kept within the bounds, and nothing where that
 * would move it back.
 */
export function stepBy(node: EngineNode, n: unknown, way: 1 | -1): void {
  if (!NUMBERED.has(typeOf(node))) throw notNumbered('step');
  const bounds = boundsOf(node);
  if (bounds.step === undefined) {
    throw domError('This input steps by any amount.', 'InvalidStateError');
  }
  // The least and the most on a step, which nothing is where no step is between the bounds.
  const lowest = onStep(Math.ceil(stepsTo(bounds.min, bounds)), bounds);
  const highest = onStep(Math.floor(stepsTo(bounds.max, bounds)), bounds);
  if (bounds.min > bounds.max || lowest > bounds.max) return;
  const before = valueAsNumber(node) || 0;
  const by = Math.trunc(Number(n ?? 1)) || 0;
  const value = Math.min(Math.max(stepped(before, by, way, bounds), lowest), highest);
  if ((way < 0 && before < value) || (way > 0 && before > value)) return;
  (node as { value?: unknown }).value = String(value);
}

/** A value moved `by` steps `way`, or to the next step `way` where it is off one. */
function stepped(value: number, by: number, way: 1 | -1, bounds: Bounds): number {
  const steps = stepsTo(value, bounds);
  if (Number.isInteger(steps)) return onStep(steps + by * way, bounds);
  return onStep(way < 0 ? Math.floor(steps) : Math.ceil(steps), bounds);
}

/** Each range a finger is on, with its value when the finger came down. */
const dragging = new WeakMap<EngineNode, string>();

interface Rect {
  readonly x: number;
  readonly width: number;
}

/**
 * A finger on a range: `down`, `move` or `up` at a place across the screen. The value goes to
 * where the finger is along the range, as a browser moves one pressed and dragged, and `input` is
 * said where that changed it. `change` is said as the finger lifts, where the value is not the
 * one it came down on. Nothing of an input that is no range, or a disabled one.
 */
export function slideRange(node: EngineNode, phase: 'down' | 'move' | 'up', x: number): void {
  if (!isRange(node)) return;
  const engine = engineOf(node);
  if (phase === 'up') {
    const was = dragging.get(node);
    dragging.delete(node);
    if (was !== undefined && was !== rangeValue(node)) engine.dispatchEvent(node, 'topChange', {});
    return;
  }
  if (disabled(node)) return;
  if (phase === 'down') dragging.set(node, rangeValue(node)!);
  if (!dragging.has(node)) return;
  const rect = (node as unknown as { getBoundingClientRect(): Rect }).getBoundingClientRect();
  if (!(rect.width > 0)) return;
  const bounds = boundsOf(node);
  const along = Math.min(Math.max((x - rect.x) / rect.width, 0), 1);
  const next = sanitized(node, String(bounds.min + along * (bounds.max - bounds.min)));
  if (next === rangeValue(node)) return;
  set.set(node, next);
  engine.dispatchEvent(node, 'topInput', {});
}
