import type { EngineNode } from '@ng-native/fabric';
import { domError } from './dom-error.ts';
import { parseUrl } from './parse-url.ts';

/**
 * HTML's reflection: a property that reads and writes a content attribute, by the attribute's
 * type. `input.placeholder` is the `placeholder` attribute as a string, `button.disabled` whether
 * there is a `disabled` attribute, `textarea.rows` the `rows` attribute as a positive number with
 * two where it is none. A component library reads and writes these as often as the attributes.
 *
 * The attribute is read and written through the element's own `getAttribute` and `setAttribute`,
 * so a write does what the attribute does to the native view. A property a template binds by its
 * own name, `[readOnly]` say, is read where it was bound too.
 *
 * A URL is resolved against the element's `baseURI`: a relative one is left as it is written
 * where that is `about:blank`, as the page's is.
 */

/** An element as reflection reads and writes it. */
export type Reflecting = EngineNode & {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};

/** What a property reads and writes, given the element. */
export interface Reflection {
  get(node: Reflecting): unknown;
  set(node: Reflecting, value: unknown): void;
}

/** What the attribute says, by the name a template may have bound the property by as well. */
export function contentOf(node: Reflecting, attribute: string, property: string): string | null {
  const written = node.getAttribute(attribute);
  if (written !== null || property === attribute) return written;
  const bound = node.props[property];
  if (bound == null || bound === false) return null;
  return bound === true ? '' : String(bound);
}

/** The prop an attribute is kept as: an `id` is the view's `nativeID`. */
const propOf = (attribute: string): string => (attribute === 'id' ? 'nativeID' : attribute);

/** Whether a boolean attribute is there: one a template bound to `false` is not. */
function present(node: Reflecting, attribute: string, property: string): boolean {
  const bound = node.props[propOf(attribute)];
  if (bound === false || node.props[property] === false) return false;
  return contentOf(node, attribute, property) !== null;
}

const ASCII_SPACE = /^[\t\n\f\r ]*/;

/** HTML's "rules for parsing integers": a sign and digits after white space, and no more. */
export function parseInteger(text: string): number | undefined {
  const found = /^([-+]?)(\d+)/.exec(text.replace(ASCII_SPACE, ''));
  if (!found) return undefined;
  const value = Number(found[2]) * (found[1] === '-' ? -1 : 1);
  return value === 0 ? 0 : value;
}

const MAX_LONG = 2147483647;

/** WebIDL's `long`: a number taken to a 32-bit integer, as a property set to one is. */
const toLong = (value: unknown): number => Number(value) | 0;
/** And `unsigned long`. */
const toUnsigned = (value: unknown): number => Number(value) >>> 0;

const indexSizeError = (value: number) =>
  domError(`The value provided (${value}) is outside the range it can be.`, 'IndexSizeError');

/** The attribute as a string, as written, or nothing where there is none. */
export const string = (attribute: string, property = attribute): Reflection => ({
  get: (node) => contentOf(node, attribute, property) ?? '',
  set: (node, value) => node.setAttribute(attribute, String(value)),
});

/** What a URL an element's attribute says is resolved against: its document's base URL. */
export const baseOf = (node: Reflecting): string =>
  String((node as { baseURI?: unknown }).baseURI ?? 'about:blank');

/** And its document's own URL, which a `<base>` and a form with nowhere to send to resolve by. */
const documentUrlOf = (node: Reflecting): string =>
  String((node as { ownerDocument?: { URL?: unknown } }).ownerDocument?.URL ?? 'about:blank');

/**
 * The attribute as a URL, resolved: as written where it is no URL, and nothing where there is no
 * attribute. `empty` is what a form's `action` reads with none or an empty one, the page's URL.
 */
export const url = (
  attribute: string,
  property = attribute,
  { against = baseOf, empty }: { against?: (node: Reflecting) => string; empty?: true } = {},
): Reflection => ({
  get: (node) => {
    const written = contentOf(node, attribute, property);
    if (!written && empty) return documentUrlOf(node);
    if (written === null) return '';
    return parseUrl(written, against(node))?.href ?? written;
  },
  set: (node, value) => node.setAttribute(attribute, String(value)),
});

/** A `<base>`'s `href`, against the document's URL rather than the base URL it is. */
export const baseHref = url('href', 'href', { against: documentUrlOf });

/** A form's `action` and a submitter's `formAction`: the page's URL where none is written. */
export const action = (attribute: string, property = attribute): Reflection =>
  url(attribute, property, { empty: true });

/** The attribute as a string, or `null` where there is none; set to `null`, it is taken away. */
export const nullable = (attribute: string, property = attribute): Reflection => ({
  get: (node) => contentOf(node, attribute, property),
  set: (node, value) => {
    if (value == null) node.removeAttribute(attribute);
    else node.setAttribute(attribute, String(value));
  },
});

/** A string an older attribute takes, which `null` sets as empty rather than as `"null"`. */
export const nullAsEmpty = (attribute: string, property = attribute): Reflection => ({
  get: (node) => contentOf(node, attribute, property) ?? '',
  set: (node, value) => node.setAttribute(attribute, value === null ? '' : String(value)),
});

/** Whether the attribute is there. Set, it is there and empty; cleared, it is gone. */
export const boolean = (attribute: string, property = attribute): Reflection => ({
  get: (node) => present(node, attribute, property),
  set: (node, value) => {
    if (value) node.setAttribute(attribute, '');
    else node.removeAttribute(attribute);
  },
});

interface Enumerated {
  keywords: readonly string[];
  /** What it is with no attribute: `null` for one that is nullable, set to `null` to remove. */
  missing?: string | null;
  /** What it is with one that is none of the keywords: what is missing, where not said. */
  invalid?: string | null;
}

/** One of a set of keywords, in any case, read as the keyword is written. */
export const enumerated = (
  attribute: string,
  { keywords, missing = '', invalid = missing }: Enumerated,
  property = attribute,
): Reflection => ({
  get: (node) => {
    const written = contentOf(node, attribute, property);
    if (written === null) return missing;
    const lower = written.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    return keywords.find((keyword) => keyword === lower) ?? invalid;
  },
  set: (node, value) => {
    // A nullable one is `DOMString?`, which takes `undefined` as `null`.
    if (value == null && missing === null) node.removeAttribute(attribute);
    else node.setAttribute(attribute, String(value));
  },
});

interface Numeric {
  /** What it is with no attribute, or one that does not read as a number in range. */
  fallback?: number | ((node: Reflecting) => number);
  /** Whether it is never negative, and set to a negative number throws. */
  nonNegative?: boolean;
}

/** A whole number: HTML's `long`, or one limited to numbers that are not negative. */
export const long = (
  attribute: string,
  { fallback = 0, nonNegative = false }: Numeric = {},
  property = attribute,
): Reflection => ({
  get: (node) => {
    const parsed = parseInteger(contentOf(node, attribute, property) ?? '');
    const fits =
      parsed !== undefined && parsed <= MAX_LONG && parsed >= (nonNegative ? 0 : -MAX_LONG - 1);
    if (fits) return parsed;
    return typeof fallback === 'function' ? fallback(node) : fallback;
  },
  set: (node, value) => {
    const number = toLong(value);
    if (nonNegative && number < 0) throw indexSizeError(number);
    node.setAttribute(attribute, String(number));
  },
});

interface Unsigned {
  /** What it is with no attribute, or one out of range. */
  fallback?: number;
  /** Whether it is never zero: set to zero, it throws, or with `orFallback` is the fallback. */
  positive?: boolean;
  orFallback?: boolean;
  /** The least and most it can be, where it is clamped to them. */
  clamp?: readonly [number, number];
}

const inRange = (number: number, least: number) => number >= least && number <= MAX_LONG;

/** HTML's `unsigned long`: a number that is never negative, and with `positive` never zero. */
export const unsigned = (
  attribute: string,
  { fallback = 0, positive = false, orFallback = false, clamp }: Unsigned = {},
  property = attribute,
): Reflection => ({
  get: (node) => {
    const parsed = parseInteger(contentOf(node, attribute, property) ?? '');
    // One clamped is any number that is not negative, however large, taken to its bounds.
    if (clamp && parsed !== undefined && parsed >= 0) {
      return Math.min(Math.max(parsed, clamp[0]), clamp[1]);
    }
    if (parsed === undefined || !inRange(parsed, positive ? 1 : 0)) return fallback;
    return parsed;
  },
  set: (node, value) => {
    let number = toUnsigned(value);
    if (positive && number === 0 && !orFallback) throw indexSizeError(number);
    if (!inRange(number, positive ? 1 : 0)) number = fallback;
    node.setAttribute(attribute, String(number));
  },
});

/** HTML's "rules for parsing floating-point number values", or nothing for text that is none. */
export function parseFloatingPoint(text: string): number | undefined {
  const found = /^([-+]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([-+]?\d+))?/.exec(
    text.replace(ASCII_SPACE, ''),
  );
  if (!found) return undefined;
  const value = Number(`${found[1]}${found[2]}${found[3] === undefined ? '' : `e${found[3]}`}`);
  if (!Number.isFinite(value)) return undefined;
  return value === 0 ? 0 : value;
}

interface Double {
  /** What it is with no attribute, or one that is no number, or with `positive` none above 0. */
  fallback?: number;
  /** Whether it is only ever above zero: set to anything else, the attribute is left as it is. */
  positive?: boolean;
}

/** HTML's `double`: a number, written as JavaScript writes one. */
export const double = (
  attribute: string,
  { fallback = 0, positive = false }: Double = {},
  property = attribute,
): Reflection => ({
  get: (node) => {
    const parsed = parseFloatingPoint(contentOf(node, attribute, property) ?? '');
    return parsed === undefined || (positive && parsed <= 0) ? fallback : parsed;
  },
  set: (node, value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new TypeError(`The value provided (${number}) is not a finite number.`);
    }
    if (positive && number <= 0) return;
    node.setAttribute(attribute, String(number));
  },
});

/** A property that is read and set by its own rules, not an attribute's. */
export const own = (
  get: (node: Reflecting) => unknown,
  set: (node: Reflecting, value: unknown) => void = () => {},
): Reflection => ({ get, set });

/** A method: the one function, which is given the element it is called on as `this`. */
export const method = (body: (this: never, ...args: never[]) => unknown): Reflection =>
  own(() => body);
