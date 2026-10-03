/**
 * The web's `aria-*` attributes as the props native reads, mapped as React Native's `View.js`
 * maps them before a view's props reach native.
 *
 * An attribute is text, on any element that commits a view: the host of an app's own component
 * has no input to take one, and a label that is dropped fails silently for exactly the people who
 * cannot see that it is missing. A prop the element already has is its own answer and is left:
 * the primitives of `@ng-native/components` take these as inputs and write the props themselves.
 */

type Props = Record<string, unknown>;

/** `'true'` and `'false'` as the booleans they say; anything else, `mixed` included, as written. */
const flag = (value: unknown): unknown =>
  value === 'true' || value === '' ? true : value === 'false' ? false : value;

/** Text as the number it says, and nothing where it says none: `NaN` is no value to send. */
const number = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const said = value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(said) ? said : undefined;
};

/** The attributes that are one prop each, with how the value is read. */
const ONE_TO_ONE: Readonly<
  Record<string, readonly [prop: string, read: (value: unknown) => unknown]>
> = {
  'aria-label': ['accessibilityLabel', (value) => value],
  'aria-labelledby': [
    'accessibilityLabelledBy',
    (value) => (typeof value === 'string' ? value.split(/\s*,\s*/) : value),
  ],
  'aria-live': ['accessibilityLiveRegion', (value) => (value === 'off' ? 'none' : value)],
  'aria-hidden': ['accessibilityElementsHidden', flag],
  'aria-modal': ['accessibilityViewIsModal', flag],
};

/** The attributes gathered into `accessibilityState`, by the key each is there. */
const STATE: Readonly<Record<string, string>> = {
  'aria-busy': 'busy',
  'aria-checked': 'checked',
  'aria-disabled': 'disabled',
  'aria-expanded': 'expanded',
  'aria-selected': 'selected',
};

/** The attributes gathered into `accessibilityValue`. */
const VALUE: Readonly<Record<string, string>> = {
  'aria-valuemax': 'max',
  'aria-valuemin': 'min',
  'aria-valuenow': 'now',
  'aria-valuetext': 'text',
};

/** `attributes` gathered into one object by `keys`, or undefined when it has none of them. */
function gathered(
  attributes: Props,
  keys: Readonly<Record<string, string>>,
  read: (key: string, value: unknown) => unknown,
): Props | undefined {
  let out: Props | undefined;
  for (const attribute of Object.keys(keys)) {
    const value = attributes[attribute];
    const said = value === undefined || value === null ? undefined : read(keys[attribute]!, value);
    if (said !== undefined) (out ??= {})[keys[attribute]!] = said;
  }
  return out;
}

/**
 * Writes into `props` what the `aria-*` attributes among `attributes` say, wherever `props` does
 * not say it already.
 */
export function applyAria(attributes: Props, props: Props): void {
  for (const attribute of Object.keys(ONE_TO_ONE)) {
    const value = attributes[attribute];
    const [prop, read] = ONE_TO_ONE[attribute]!;
    if (value !== undefined && value !== null && props[prop] === undefined)
      props[prop] = read(value);
  }
  // As `View.js`: a hidden element takes what is inside it out of the accessibility tree on
  // Android too, which has no prop of its own for that.
  if (flag(attributes['aria-hidden']) === true)
    props['importantForAccessibility'] ??= 'no-hide-descendants';
  const state = gathered(attributes, STATE, (_, value) => flag(value));
  if (state) props['accessibilityState'] ??= state;
  const value = gathered(attributes, VALUE, (key, part) => (key === 'text' ? part : number(part)));
  if (value) props['accessibilityValue'] ??= value;
}
