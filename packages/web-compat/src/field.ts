import { markComponentHost, type Engine, type EngineNode } from '@ng-native/fabric';
import { documentOf } from './document.ts';
import { keepTaken } from './node-members.ts';

/**
 * `<input>` and `<textarea>`: the platform's text field, in an app that asked for this package.
 * What is typed is kept here as it is reported, so `input.value` reads it at once, and a value a
 * script or a binding sets is the field's text. Its `type`, `inputmode`, `autocomplete` and
 * `maxlength` are the keyboard and entry native has for them, and `disabled` and `readonly` make
 * it one that cannot be typed into.
 */

/** The HTML elements that are the platform's text field. */
const FIELDS: ReadonlySet<string> = new Set(['input', 'textarea']);

/** What a field's JavaScript side knows of it: its text, and how many edits native has reported. */
interface Field {
  text: string;
  count: number;
  disabled: boolean;
  readOnly: boolean;
  /** Whether a fieldset around it is disabled: see `fieldset.ts`. */
  fenced: boolean;
  /** Whether anything was typed or set: a text area's value is what it holds before. */
  edited: boolean;
  /** When a listener last stopped a key native is about to make an edit for. */
  refused?: number;
}

const fields = new WeakMap<EngineNode, Field>();

export const isField = (node: EngineNode): boolean => fields.has(node);

/** The inputs made plain views here for a type that is not typed into. */
const hostedHere = new WeakSet<EngineNode>();

/** How long after a key was stopped the edit native makes for it is still that key's. */
const REFUSED_MS = 250;
/** The edits that were put back, which no listener is told of. */
const refused = new WeakSet<object>();

/**
 * Have the edit native is about to make for a key put back: a listener stopped the key, which
 * in a browser is then no edit. Native makes it whatever is said of the key.
 */
export function refuseEdit(node: EngineNode): void {
  const field = fields.get(node);
  if (field) field.refused = Date.now();
}

/** Whether a native event is an edit that was put back. */
export const wasRefused = (event: unknown): boolean =>
  typeof event === 'object' && event !== null && refused.has(event);

/** A field's text, as `input.value` reads it: what was last typed or set. */
export const valueOf = (node: EngineNode): string | undefined => fields.get(node)?.text;

/** Whether anything was typed in a field or set as its text since it was made or reset. */
export const isEdited = (node: EngineNode): boolean => fields.get(node)?.edited === true;

/** What an `<input type>` is on a native text field. A type not here is plain text. */
const TYPES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  password: { secureTextEntry: true },
  email: { keyboardType: 'email-address', autoCapitalize: 'none' },
  number: { keyboardType: 'numeric' },
  tel: { keyboardType: 'phone-pad' },
  url: { keyboardType: 'url', autoCapitalize: 'none' },
  search: { returnKeyType: 'search' },
};
/** The keyboard an `inputmode` asks for. One not here, `text` or `none`, is the plain one. */
const KEYBOARDS: Readonly<Record<string, string>> = {
  numeric: 'number-pad',
  decimal: 'decimal-pad',
  tel: 'phone-pad',
  email: 'email-address',
  url: 'url',
  search: 'web-search',
};
/**
 * What an `autocomplete` has the system offer: iOS reads the first, Android the second. The
 * tokens a sign-in or a one-time code is written with; one not here offers nothing.
 */
const AUTOFILL: Readonly<Record<string, readonly [ios: string, android: string]>> = {
  'one-time-code': ['oneTimeCode', 'sms-otp'],
  email: ['emailAddress', 'email'],
  username: ['username', 'username'],
  'current-password': ['password', 'password'],
  'new-password': ['newPassword', 'password-new'],
  tel: ['telephoneNumber', 'tel'],
  name: ['name', 'name'],
};
/** The input types that are typed into. Any other is a control of another kind. */
const TEXT_TYPES = new Set(['text', 'email', 'password', 'number', 'tel', 'url', 'search']);
const TYPE_PROPS = [...new Set(Object.values(TYPES).flatMap(Object.keys))];

/**
 * What a field has by default that the view does not: no line under it and no padding above and
 * below its text, which Android gives one and a field shorter than the two clips its text on,
 * and the twenty characters' width a browser has a field with no width of its own, HTML's `size`,
 * which the engine makes a width of in the field's own font. Any width, padding or `size` of its
 * own wins over these. A default of each field's own, and not the view's: a `<text-input>` of an
 * app that did not ask keeps what it has.
 */
const FIELD_DEFAULTS = {
  underlineColorAndroid: 'transparent',
  paddingTop: 0,
  paddingBottom: 0,
  size: 20,
};

/**
 * Give a field what a browser's has, or take it away where its type makes it another kind of
 * control.
 */
function asAField(node: EngineNode, engine: Engine, typed: boolean): void {
  const rest = { ...node.defaultStyle };
  for (const key of Object.keys(FIELD_DEFAULTS)) delete rest[key];
  engine.setDefaultStyle(node, typed ? { ...rest, ...FIELD_DEFAULTS } : rest);
}

/**
 * `caret-color` on a field, which is a prop of a native text input and no style: a transparent
 * caret is one that is hidden, as a one-time code field hides its own to draw one per slot, and
 * any other colour is the selection's and caret's. Answers whether the declaration was one.
 */
export function caretColor(
  node: EngineNode,
  name: string,
  value: unknown,
  engine: Engine,
): boolean {
  if ((name !== 'caret-color' && name !== 'caretColor') || !fields.has(node)) return false;
  const hidden = value === 'transparent';
  const colour = hidden || value == null || value === 'auto' ? null : value;
  engine.setProp(node, 'caretHidden', hidden ? true : null);
  engine.setProp(node, 'selectionColor', colour);
  return true;
}

/** Make an `<input>` or `<textarea>` a text field that keeps up with what is typed into it. */
export function createField(node: EngineNode, engine: Engine): void {
  if (!FIELDS.has(node.tag)) return;
  // A plain view, as it is without this package, in an app that did not ask for it: the name
  // is the text field's for every app while one that asked is up.
  if (!documentOf(engine)) return markComponentHost(node);
  if (node.tag === 'textarea') engine.setProp(node, 'multiline', true);
  becomeField(node, engine);
  // Before any listener a template adds, so `event.target.value` is already the new text in it.
  engine.setEventListener(node, 'topChange', (event) => {
    const field = fields.get(node);
    if (field) typed(node, field, event, engine);
  });
}

/** A text field, from now on: one made, or an input whose type is one that is typed into again. */
function becomeField(node: EngineNode, engine: Engine): void {
  const field: Field = {
    text: String(node.props['text'] ?? ''),
    count: 0,
    disabled: on(node.props['disabled']),
    readOnly: on(node.props['readonly']),
    fenced: false,
    edited: false,
  };
  fields.set(node, field);
  setEditable(node, field, engine);
  // A text area too: twenty columns, where it has no `cols` of its own.
  asAField(node, engine, true);
}

/** What native says was typed: the field's text, or put back where a listener stopped its key. */
function typed(node: EngineNode, field: Field, event: unknown, engine: Engine): void {
  const { text, eventCount } = (event as { nativeEvent: { text?: string; eventCount?: number } })
    .nativeEvent;
  field.count = eventCount ?? field.count;
  if (Date.now() - (field.refused ?? 0) < REFUSED_MS) {
    // The line native added for a key that was stopped: the field is put back as it was.
    field.refused = undefined;
    refused.add(event as object);
    engine.setProp(node, 'mostRecentEventCount', field.count);
    engine.dispatchCommand(node, 'setTextAndSelection', [field.count, field.text, -1, -1]);
    return;
  }
  field.text = text ?? '';
  field.edited = true;
  // Native takes a text set from here only when it is told which edit it follows.
  engine.setProp(node, 'mostRecentEventCount', field.count);
}

/** Select part of a field's text on the native field, as React Native's `setSelection` does. */
export function selectNatively(node: EngineNode, start: number, end: number, engine: Engine): void {
  const field = fields.get(node);
  if (field) engine.dispatchCommand(node, 'setTextAndSelection', [field.count, null, start, end]);
}

/** A boolean HTML attribute or property: present, and not `false`. */
const on = (value: unknown): boolean => value != null && value !== false && value !== 'false';

/** Set whether a field can be typed into: not where it is disabled, fenced or read only. */
function setEditable(node: EngineNode, field: Field, engine: Engine): void {
  const off = field.disabled || field.readOnly || field.fenced;
  engine.setProp(node, 'editable', off ? false : null);
}

/** A field a disabled fieldset is around, or is no longer: see `fieldset.ts`. */
export function fenceField(node: EngineNode, fenced: boolean, engine: Engine): void {
  const field = fields.get(node);
  if (!field || field.fenced === fenced) return;
  field.fenced = fenced;
  setEditable(node, field, engine);
}

/** Set a field's text, as typed, and on the native field. */
function setText(node: EngineNode, field: Field, value: unknown, engine: Engine): void {
  const text = value == null ? '' : String(value);
  // What is typed is native's alone: the text the view was given is as it was. So a value that
  // is the one it was given, set over something typed, is no change to send, and is set by the
  // command React Native sets a controlled field's text with. A library that makes a chip of
  // what was typed sets the value to nothing after.
  if (text !== field.text && (node.props['text'] ?? '') === text) {
    engine.dispatchCommand(node, 'setTextAndSelection', [field.count, text, -1, -1]);
  }
  field.text = text;
  field.edited = true;
  engine.setProp(node, 'text', text);
}

/** `input.value = text` from a script: the field's text, and no attribute. */
export function setValue(node: EngineNode, value: unknown, engine: Engine): boolean {
  const field = fields.get(node);
  if (field) setText(node, field, value, engine);
  return field !== undefined;
}

/** A form reset: the field's text is its default, as though nothing was typed or set. */
export function resetField(node: EngineNode, text: string, engine: Engine): void {
  const field = fields.get(node);
  if (!field) return;
  setText(node, field, text, engine);
  field.edited = false;
}

/**
 * What each attribute or property of a field sets on the native text field. Each answers whether
 * that is all of it: `false` has it set as written too, for a stylesheet or a click that reads it.
 */
const SETTERS: Readonly<
  Record<string, (field: Field, node: EngineNode, value: unknown, engine: Engine) => boolean>
> = {
  // The text, and kept as written too, where native is not sent it: it is the field's
  // `defaultValue`, read back as the attribute, and what a form's reset puts back.
  value(field, node, value, engine) {
    setText(node, field, value, engine);
    engine.setProp(node, 'value', value);
    engine.keepAsAttribute(node, 'value');
    return true;
  },
  // How many characters wide it is with no width of its own, which is a browser's twenty where
  // the field says none (zero, or less, is none): the field's own default is that twenty, and
  // taking the prop away leaves it. A text area's columns are its size, by the name it has for
  // them. Kept as written too, to read back: the prop is the number or none.
  cols(_, node, value, engine) {
    return node.tag === 'textarea' && setSize(node, 'cols', value, engine);
  },
  size(_, node, value, engine) {
    return node.tag === 'input' && setSize(node, 'size', value, engine);
  },
  // Kept as written too: a stylesheet selects on `[type="email"]`.
  type(_, node, value, engine) {
    if (node.tag !== 'input') return false;
    // A radio, a checkbox, a file or a hidden input is no text field: a library keeps one out
    // of sight under a control it draws itself. It is a plain view, as its own host would be.
    if (!TEXT_TYPES.has(String(value ?? 'text').toLowerCase())) {
      asAField(node, engine, false);
      fields.delete(node);
      hostedHere.add(node);
      markComponentHost(node);
      return false;
    }
    for (const prop of TYPE_PROPS) engine.setProp(node, prop, null);
    for (const [prop, set] of Object.entries(TYPES[String(value).toLowerCase()] ?? {})) {
      engine.setProp(node, prop, set);
    }
    return false;
  },
  // Kept as written too: `:disabled` is the attribute, and a click reads it.
  disabled(field, node, value, engine) {
    field.disabled = on(value);
    setEditable(node, field, engine);
    return false;
  },
  // Kept as written too: `:read-only` and `readOnly` read it.
  readonly(field, node, value, engine) {
    field.readOnly = on(value);
    setEditable(node, field, engine);
    return false;
  },
  // The keyboard alone: an `inputmode` beside a `type` is the more specific of the two.
  inputmode(_, node, value, engine) {
    engine.setProp(node, 'keyboardType', KEYBOARDS[String(value)] ?? null);
    return false;
  },
  autocomplete(_, node, value, engine) {
    const [ios, android] = AUTOFILL[String(value)] ?? [null, null];
    engine.setProp(node, 'textContentType', ios);
    engine.setProp(node, 'autoComplete', android);
    return false;
  },
  maxlength(_, node, value, engine) {
    const most = Number.parseInt(String(value ?? ''), 10);
    engine.setProp(node, 'maxLength', most >= 0 ? most : null);
    return false;
  },
};

/** A field's size in characters, or none where it is not a number above zero. */
function setSize(node: EngineNode, attribute: string, value: unknown, engine: Engine): true {
  const characters = Number(value);
  engine.setProp(node, 'size', characters > 0 ? characters : null);
  keepTaken(node, attribute, value);
  return true;
}

/**
 * Set an attribute or property of a field as the props a native text field reads. Answers
 * whether it was taken: any other, and the ones a selector reads, are set as written.
 */
export function setField(node: EngineNode, name: string, value: unknown, engine: Engine): boolean {
  // An input made another kind of control, given a type that is typed into again.
  if (name === 'type' && hostedHere.delete(node)) {
    (node as { componentHost?: true }).componentHost = undefined;
    becomeField(node, engine);
  }
  const field = fields.get(node);
  const set = field && SETTERS[name.toLowerCase()];
  return set ? set(field, node, value, engine) : false;
}

/** The native event behind a DOM event a field's listener asks for, where they are not alike. */
export const FIELD_EVENTS: Readonly<Record<string, string>> = {
  input: 'topChange',
  change: 'topEndEditing',
  // Native says a key was pressed, once: it is down and then up.
  keydown: 'topKeyPress',
  keyup: 'topKeyPress',
};

/** The codes of the keys with a name, which a library compares `keyCode` with. */
const KEY_CODES: Readonly<Record<string, number>> = {
  Enter: 13,
  Backspace: 8,
  Tab: 9,
  Escape: 27,
  ' ': 32,
  ',': 188,
};

/**
 * What a keyboard event says of the key a native key press names: its `key`, and the `keyCode`
 * a library written before `key` still reads. Nothing for an event that is no key press.
 *
 * ponytail: a letter's or a digit's code, and the few named above. Punctuation other than a
 * comma has no code here; add it if a library separates on one.
 */
export function keyOf(native: { key?: unknown } | undefined): object {
  const key = native?.key;
  if (typeof key !== 'string') return {};
  const keyCode = KEY_CODES[key] ?? (/^[a-z0-9]$/i.test(key) ? key.toUpperCase().charCodeAt(0) : 0);
  return { key, keyCode, which: keyCode, code: key.length === 1 ? '' : key };
}
