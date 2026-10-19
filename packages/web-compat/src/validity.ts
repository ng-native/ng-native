import type { EngineNode } from '@ng-native/fabric';
import { newEvent } from './events.ts';
import { controlsOf, formOf } from './form-controls.ts';
import { method, own, type Reflecting, type Reflection } from './reflect.ts';
import { elementsUnder } from './element-tree.ts';
import { fenced } from './fieldset.ts';

/**
 * HTML's constraint validation: `validity`, `willValidate`, `validationMessage`,
 * `checkValidity()`, `reportValidity()` and `setCustomValidity()` on a form control, and the
 * two methods on a form. Angular's forms and Material read `validity` of a field to tell a
 * number typed badly from one not typed at all.
 *
 * Each flag is worked out from the control as it is when it is read: there is nothing kept but
 * the message a script set.
 *
 * ponytail: `tooLong` and `tooShort` are only for what a person typed, which native does not let
 * past `maxlength`; both are false. `badInput` is false: a native field holds only text. A week
 * is not compared with `min` and `max`. `reportValidity()` shows nothing.
 */

type Control = Reflecting & {
  value?: unknown;
  checked?: unknown;
  dispatchEvent(event: unknown): boolean;
};

/** What a script said is wrong with each control, until it says nothing is. */
const custom = new WeakMap<EngineNode, string>();

const typeOf = (node: Control) => String(node.getAttribute('type') ?? 'text').toLowerCase();
const has = (node: Control, name: string) => node.getAttribute(name) !== null;
const valueOf = (node: Control) => String(node.value ?? '');

/** The input types that are never validated, and those a read-only one is not either. */
const BARRED_INPUTS = new Set(['hidden', 'reset', 'button']);
const VALIDATED = new Set(['input', 'button', 'select', 'textarea']);

/** Whether a control is under a datalist, or a disabled fieldset: see `fieldset.ts`. */
function disabledAbove(node: EngineNode): boolean {
  for (let at = node.parent; at; at = at.parent) if (at.tag === 'datalist') return true;
  return fenced(node);
}

/** HTML's "candidate for constraint validation". */
function willValidate(node: Control): boolean {
  if (!VALIDATED.has(node.tag) || on(node.props['disabled']) || disabledAbove(node)) return false;
  if (node.tag === 'button') return !BARRED_INPUTS.has(typeOf(node));
  if (node.tag === 'select') return true;
  if (has(node, 'readonly')) return false;
  return node.tag === 'textarea' || !BARRED_INPUTS.has(typeOf(node));
}

/** Whether a radio's group has one checked: the radios of its name in its form, or its page. */
function groupChecked(node: Control): boolean {
  const name = node.getAttribute('name');
  if (!name) return !!node.checked;
  const form = formOf(node);
  let top: EngineNode = node;
  while (top.parent) top = top.parent;
  for (const other of elementsUnder(form ?? top) as Iterable<Control>) {
    const radio = other.tag === 'input' && typeOf(other) === 'radio';
    if (radio && other.getAttribute('name') === name && other.checked) return true;
  }
  return false;
}

function valueMissing(node: Control): boolean {
  if (!has(node, 'required')) return false;
  if (node.tag !== 'input') return valueOf(node) === '';
  const type = typeOf(node);
  if (type === 'checkbox') return !node.checked;
  if (type === 'radio') return !groupChecked(node);
  return valueOf(node) === '';
}

/** HTML's valid e-mail address, as its spec writes the pattern. */
const EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function typeMismatch(node: Control): boolean {
  const value = valueOf(node);
  if (node.tag !== 'input' || value === '') return false;
  const type = typeOf(node);
  if (type === 'email') {
    const each = has(node, 'multiple') ? value.split(',').map((one) => one.trim()) : [value];
    return each.some((one) => !EMAIL.test(one));
  }
  if (type !== 'url') return false;
  try {
    new URL(value);
    return false;
  } catch {
    return true;
  }
}

/** A `pattern` as HTML compiles it: the whole value, with the `v` flag where it is known. */
function patternOf(source: string): RegExp | undefined {
  for (const flags of ['v', 'u']) {
    try {
      return new RegExp(`^(?:${source})$`, flags);
    } catch {
      // An engine without the `v` flag, or a pattern that is no pattern: which is no constraint.
    }
  }
  return undefined;
}

function patternMismatch(node: Control): boolean {
  const pattern = node.getAttribute('pattern');
  const value = valueOf(node);
  if (pattern === null || value === '' || node.tag !== 'input') return false;
  const compiled = patternOf(pattern);
  if (!compiled) return false;
  const each = has(node, 'multiple') ? value.split(',') : [value];
  return each.some((one) => !compiled.test(one));
}

const FLOAT = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/;

/** A value of an input that has a range as a number to compare, or nothing for one with none. */
function numberOf(type: string, text: string | null): number | undefined {
  if (text === null || text === '') return undefined;
  if (type === 'number' || type === 'range') return FLOAT.test(text) ? Number(text) : undefined;
  if (type === 'date') return Date.parse(`${text}T00:00Z`) || undefined;
  if (type === 'datetime-local') return Date.parse(`${text}Z`) || undefined;
  if (type === 'month') {
    const [year, month] = text.split('-').map(Number);
    return year! * 12 + month!;
  }
  if (type === 'time') return Date.parse(`1970-01-01T${text}Z`);
  return undefined;
}

/** How a value compares with its `min` and `max`, and whether it is on a step. */
function range(node: Control) {
  const type = typeOf(node);
  const none = { under: false, over: false, step: false };
  if (node.tag !== 'input') return none;
  const value = numberOf(type, valueOf(node));
  if (value === undefined || Number.isNaN(value)) return none;
  const min = numberOf(type, node.getAttribute('min'));
  const max = numberOf(type, node.getAttribute('max'));
  const written = node.getAttribute('step');
  const step = written === null ? 1 : Number(written);
  const steps = type === 'number' || type === 'range';
  const offStep = (from: number) => {
    const count = (value - from) / step;
    return Math.abs(count - Math.round(count)) > 1e-9;
  };
  return {
    under: min !== undefined && value < min,
    over: max !== undefined && value > max,
    step: steps && step > 0 && Number.isFinite(step) && offStep(min ?? 0),
  };
}

/** The flags a `ValidityState` has, worked out now. */
function flagsOf(node: Control) {
  const validated = willValidate(node);
  const at = validated ? range(node) : { under: false, over: false, step: false };
  const flags = {
    valueMissing: validated && valueMissing(node),
    typeMismatch: validated && typeMismatch(node),
    patternMismatch: validated && patternMismatch(node),
    tooLong: false,
    tooShort: false,
    rangeUnderflow: at.under,
    rangeOverflow: at.over,
    stepMismatch: at.step,
    badInput: false,
    customError: validated && !!custom.get(node),
  };
  return { ...flags, valid: !Object.values(flags).some(Boolean) };
}

type Flags = ReturnType<typeof flagsOf>;

const FLAGS: readonly (keyof Flags)[] = [
  'valueMissing',
  'typeMismatch',
  'patternMismatch',
  'tooLong',
  'tooShort',
  'rangeUnderflow',
  'rangeOverflow',
  'stepMismatch',
  'badInput',
  'customError',
  'valid',
];

/** The control each `ValidityState` is of. */
const controls = new WeakMap<object, Control>();

/** `ValidityState`: each flag read off the control when it is read. */
export class ValidityState {
  get [Symbol.toStringTag]() {
    return 'ValidityState';
  }
}
for (const name of FLAGS) {
  Object.defineProperty(ValidityState.prototype, name, {
    get(this: ValidityState) {
      return flagsOf(controls.get(this)!)[name];
    },
    enumerable: true,
    configurable: true,
  });
}

/** Each control's `validity`, the one object for as long as the control is. */
const states = new WeakMap<EngineNode, ValidityState>();

/** What a browser says of the first constraint a control fails. */
const MESSAGES: readonly [keyof Flags, string][] = [
  ['valueMissing', 'Please fill out this field.'],
  ['typeMismatch', 'Please enter a valid value.'],
  ['patternMismatch', 'Please match the requested format.'],
  ['rangeUnderflow', 'Value is too low.'],
  ['rangeOverflow', 'Value is too high.'],
  ['stepMismatch', 'Please enter a valid value.'],
];

function messageOf(node: Control): string {
  const flags = flagsOf(node);
  if (flags.valid) return '';
  if (flags.customError) return custom.get(node)!;
  return MESSAGES.find(([flag]) => flags[flag])?.[1] ?? '';
}

/** Whether a control passes, telling it `invalid` where it does not, as `checkValidity` does. */
function check(node: Control): boolean {
  if (flagsOf(node).valid) return true;
  node.dispatchEvent(newEvent('invalid', { cancelable: true }));
  return false;
}

/** A boolean HTML attribute or property: present, and not `false`. */
const on = (value: unknown): boolean => value != null && value !== false && value !== 'false';

/** A method whose body is given the element it is called on. */
const called = (body: (node: Control, ...args: unknown[]) => unknown): Reflection =>
  method(function (this: Control, ...args: unknown[]) {
    return body(this, ...args);
  });

const CONTROL: Readonly<Record<string, Reflection>> = {
  validity: own((node) => {
    let state = states.get(node);
    if (!state) {
      states.set(node, (state = new ValidityState()));
      controls.set(state, node as Control);
    }
    return state;
  }),
  willValidate: own((node) => willValidate(node as Control)),
  validationMessage: own((node) => messageOf(node as Control)),
  checkValidity: called(check),
  reportValidity: called(check),
  setCustomValidity: called((node, message) => {
    if (message) custom.set(node, String(message));
    else custom.delete(node);
  }),
};

/** A form's: whether every control of it passes, each that does not told `invalid`. */
const formCheck = called((node) => checkForm(node));

/** Whether every control of a form passes, in the order of the page, each that does not told `invalid`. */
export function checkForm(form: EngineNode): boolean {
  const results = (controlsOf(form) as Control[])
    .filter((node) => VALIDATED.has(node.tag))
    .map(check);
  return results.every(Boolean);
}

/** The validation members, by element. */
export const VALIDATION: Readonly<Record<string, Readonly<Record<string, Reflection>>>> = {
  input: CONTROL,
  button: CONTROL,
  select: CONTROL,
  textarea: CONTROL,
  fieldset: CONTROL,
  output: CONTROL,
  object: CONTROL,
  form: { checkValidity: formCheck, reportValidity: formCheck },
};
