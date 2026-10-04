import { markComponentHost, type Engine, type EngineNode } from '@ng-native/fabric';
import { documentOf } from './document.ts';

/** The HTML elements that are the platform's text field. */
const FIELDS = new Set(['input', 'textarea']);

/** What a field's JavaScript side knows of it: its text, and how many edits native has reported. */
interface Field {
  text: string;
  count: number;
  disabled: boolean;
  readOnly: boolean;
}

const fields = new WeakMap<EngineNode, Field>();

export const isField = (node: EngineNode): boolean => fields.has(node);

/** A field's text, as `input.value` reads it: what was last typed or set. */
export const valueOf = (node: EngineNode): string | undefined => fields.get(node)?.text;

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

/** Make an `<input>` or `<textarea>` a text field that keeps up with what is typed into it. */
export function createField(node: EngineNode, engine: Engine): void {
  if (!FIELDS.has(node.name) || !documentOf(engine)) return;
  const field: Field = { text: '', count: 0, disabled: false, readOnly: false };
  fields.set(node, field);
  if (node.name === 'textarea') engine.setProp(node, 'multiline', true);
  // Before any listener a template adds, so `event.target.value` is already the new text in it.
  engine.setEventListener(node, 'topChange', (event) => {
    const { text, eventCount } = (event as { nativeEvent: { text?: string; eventCount?: number } })
      .nativeEvent;
    field.text = text ?? '';
    field.count = eventCount ?? field.count;
    // Native takes a text set from here only when it is told which edit it follows.
    engine.setProp(node, 'mostRecentEventCount', field.count);
  });
}

/** A boolean HTML attribute or property: present, and not `false`. */
const on = (value: unknown): boolean => value != null && value !== false && value !== 'false';

/** Whether a field can be typed into: neither disabled nor read-only. Unset is yes. */
const editable = (field: Field) => (field.disabled || field.readOnly ? false : null);

/**
 * What each attribute or property of a field sets on the native text field. Each answers whether
 * that is all of it: `false` has it set as written too, for a stylesheet or a click that reads it.
 */
const SETTERS: Readonly<
  Record<string, (field: Field, node: EngineNode, value: unknown, engine: Engine) => boolean>
> = {
  value(field, node, value, engine) {
    field.text = value == null ? '' : String(value);
    engine.setProp(node, 'text', field.text);
    return true;
  },
  // Kept as written too: a stylesheet selects on `[type="email"]`.
  type(_, node, value, engine) {
    // A radio, a checkbox, a file or a hidden input is no text field: a library keeps one out
    // of sight under a control it draws itself. It is a plain view, as its own host would be.
    if (!TEXT_TYPES.has(String(value ?? 'text'))) {
      fields.delete(node);
      markComponentHost(node);
      return false;
    }
    for (const prop of TYPE_PROPS) engine.setProp(node, prop, null);
    for (const [prop, set] of Object.entries(TYPES[String(value)] ?? {})) {
      engine.setProp(node, prop, set);
    }
    return false;
  },
  // Kept as written too: `:disabled` is the attribute, and a click reads it.
  disabled(field, node, value, engine) {
    field.disabled = on(value);
    engine.setProp(node, 'editable', editable(field));
    return false;
  },
  readonly(field, node, value, engine) {
    field.readOnly = on(value);
    engine.setProp(node, 'editable', editable(field));
    return true;
  },
  // The keyboard alone: an `inputmode` beside a `type` is the more specific of the two.
  inputmode(_, node, value, engine) {
    engine.setProp(node, 'keyboardType', KEYBOARDS[String(value)] ?? null);
    return true;
  },
  autocomplete(_, node, value, engine) {
    const [ios, android] = AUTOFILL[String(value)] ?? [null, null];
    engine.setProp(node, 'textContentType', ios);
    engine.setProp(node, 'autoComplete', android);
    return true;
  },
  maxlength(_, node, value, engine) {
    engine.setProp(node, 'maxLength', value == null ? null : Number(value));
    return true;
  },
};

/**
 * Set an attribute or property of a field as the props a native text field reads. Answers
 * whether it was taken: any other, and the ones a selector reads, are set as written.
 */
export function setField(node: EngineNode, name: string, value: unknown, engine: Engine): boolean {
  const field = fields.get(node);
  const set = field && SETTERS[name.toLowerCase()];
  return set ? set(field, node, value, engine) : false;
}

/** The native event behind a DOM event a field's listener asks for, where they are not alike. */
export const FIELD_EVENTS: Readonly<Record<string, string>> = {
  input: 'topChange',
  change: 'topEndEditing',
};
