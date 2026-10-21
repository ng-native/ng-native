import type { EngineNode } from '@ng-native/fabric';
import { documentOf } from './document.ts';
import { elementsUnder } from './element-tree.ts';
import { isEdited, resetField, setValue, valueOf } from './field.ts';
import { liveCollection } from './live-list.ts';
import { own, type Reflecting, type Reflection } from './reflect.ts';
import {
  chosen,
  optionsOf,
  selectAt,
  selectedIndex,
  selectOf,
  selectValue,
  setSelect,
  setSelected,
} from './select.ts';
import { engineOf } from './window.ts';

/**
 * The properties of a form control that are its own and no attribute's, or not only one's: what
 * it holds, whether it is checked, its kind, the form it is in, and a form's and a select's
 * lists. A field's text and a select's choice are kept with the native view (`field.ts`,
 * `select.ts`); here is what each answers of them, as a browser's does.
 */

const typeOf = (node: Reflecting): string =>
  String(node.getAttribute('type') ?? 'text').toLowerCase();

const on = (value: unknown): boolean => value != null && value !== false && value !== 'false';

/** The input types whose value is the attribute, and the two that say `on` with none. */
const DEFAULT_VALUE = new Set(['hidden', 'submit', 'image', 'reset', 'button']);
const DEFAULT_ON = new Set(['checkbox', 'radio']);

/** The value set on an input that is neither a field nor kept as its attribute: a date's. */
const values = new WeakMap<EngineNode, string>();

/**
 * `input.value`: a text field's text as typed, the attribute for a button, a hidden input, a
 * checkbox and a radio, which say `on` with none, and what was set on any other.
 */
const inputValue: Reflection = own(
  (node) => {
    const typed = valueOf(node);
    if (typed !== undefined) return typed;
    const type = typeOf(node);
    if (DEFAULT_VALUE.has(type) || DEFAULT_ON.has(type)) {
      return node.getAttribute('value') ?? (DEFAULT_ON.has(type) ? 'on' : '');
    }
    if (type === 'file') return '';
    return values.get(node) ?? node.getAttribute('value') ?? '';
  },
  (node, value) => {
    const text = value == null ? '' : String(value);
    if (setValue(node, text, engineOf(node))) return;
    const type = typeOf(node);
    if (DEFAULT_VALUE.has(type) || DEFAULT_ON.has(type)) node.setAttribute('value', text);
    else if (type !== 'file') values.set(node, text);
  },
);

const textOf = (node: EngineNode): string =>
  node.nodeKind === 'text' ? node.nodeText : node.childList.map(textOf).join('');
const collapsed = (text: string) => text.replace(/[\t\n\f\r ]+/g, ' ').trim();

/** `textarea.value`: the field's text, or what it holds before anything is typed or set. */
const textareaValue: Reflection = own(
  (node) => (isEdited(node) ? (valueOf(node) ?? '') : textOf(node)),
  (node, value) => void setValue(node, value, engineOf(node)),
);

/** `textarea.defaultValue`: what it holds, which a reset puts back. */
const textareaDefault: Reflection = own(textOf, (node, value) => {
  (node as unknown as { textContent: unknown }).textContent = value;
});

/** Each checkbox's and radio's checked state, once a click or a script has set it. */
const checkedness = new WeakMap<EngineNode, boolean>();

/** The radios of the same group as one: the same name, in the same form, or the same page. */
export function groupOf(node: Reflecting): Reflecting[] {
  const name = node.getAttribute('name');
  if (!name) return [];
  const form = formOf(node);
  let top: EngineNode = node;
  while (top.parent) top = top.parent;
  return [...elementsUnder(top)].filter(
    (other) =>
      other !== node &&
      other.tag === 'input' &&
      typeOf(other as Reflecting) === 'radio' &&
      (other as Reflecting).getAttribute('name') === name &&
      formOf(other as Reflecting) === form,
  ) as Reflecting[];
}

/** Whether a checkbox or a radio is checked: as set, or as its `checked` attribute says. */
export function isChecked(node: EngineNode): boolean {
  return checkedness.get(node) ?? on(node.props['checked']);
}

/**
 * Check a checkbox or a radio, or uncheck it, as `checked` set does: a radio checked unchecks
 * the others of its group.
 */
export function setChecked(node: EngineNode, value: boolean): void {
  checkedness.set(node, value);
  if (!value || typeOf(node as Reflecting) !== 'radio') return;
  for (const other of groupOf(node as Reflecting)) checkedness.set(other, false);
}

/**
 * `checked`: the state a click or a script sets, which starts as the attribute says, and is put
 * back to it by a reset. `defaultChecked` is the attribute.
 */
const checked: Reflection = own(isChecked, (node, value) => setChecked(node, !!value));

/** `indeterminate`, which only a script sets, and nothing else reads but `:indeterminate`. */
const indeterminates = new WeakSet<EngineNode>();
const indeterminate: Reflection = own(
  (node) => indeterminates.has(node),
  (node, value) => void (value ? indeterminates.add(node) : indeterminates.delete(node)),
);

/** The form a control is in: the one its `form` attribute names, or the one it is inside. */
export function formOf(node: Reflecting): EngineNode | null {
  const named = node.getAttribute('form');
  if (named !== null) {
    const find = documentOf(engineOf(node))?.['getElementById'] as
      ((id: string) => EngineNode | null) | undefined;
    const found = find?.(named) ?? null;
    return found?.tag === 'form' ? found : null;
  }
  for (let at = node.parent; at; at = at.parent) if (at.tag === 'form') return at;
  return null;
}

/** Read only: a template that binds it, or a script that sets it, changes nothing. */
const form: Reflection = own(formOf);

/** The elements a form lists as its own: an image button is not among them. */
const LISTED = new Set(['button', 'fieldset', 'input', 'object', 'output', 'select', 'textarea']);
const isListed = (node: EngineNode): boolean =>
  node.nodeKind === 'element' &&
  LISTED.has(node.tag) &&
  !(node.tag === 'input' && typeOf(node as Reflecting) === 'image');

/** The controls of a form, in the order of the page: those in it and those that name it. */
export function controlsOf(form: EngineNode): EngineNode[] {
  let top: EngineNode = form;
  while (top.parent) top = top.parent;
  return [...elementsUnder(top)].filter(
    (node) => isListed(node) && formOf(node as Reflecting) === form,
  );
}

/** `form.elements`, the one live list for as long as the form is. */
const elementLists = new WeakMap<EngineNode, object>();
const formElements: Reflection = own((node) => {
  let list = elementLists.get(node);
  if (!list) {
    list = liveCollection(engineOf(node), () => controlsOf(node));
    elementLists.set(node, list);
  }
  return list;
});

/** `fieldset.elements`: the listed elements inside it. */
const fieldsetElements: Reflection = own((node) => {
  let list = elementLists.get(node);
  if (!list) {
    list = liveCollection(engineOf(node), () => [...elementsUnder(node)].filter(isListed));
    elementLists.set(node, list);
  }
  return list;
});

/** What a select says it is, by whether it can have more than one chosen. */
const selectType: Reflection = own((node) =>
  node.getAttribute('multiple') === null ? 'select-one' : 'select-multiple',
);

/** A select's options, as a list a script reads by place and takes one out of. */
function optionList(node: EngineNode): EngineNode[] {
  const remove = (at: number) =>
    (optionsOf(node)[at] as unknown as { remove?(): void } | undefined)?.remove?.();
  const list = optionsOf(node);
  return Object.assign(list, { remove, item: (at: number) => list[at] ?? null });
}

type Inserting = { insertBefore(child: unknown, before: unknown): unknown };

/** `select.add(option, before)`: before the option given, or the one at that place. */
const addOption: Reflection = own(
  (node) =>
    function (this: Inserting, option: EngineNode, before?: EngineNode | number | null) {
      const next = typeof before === 'number' ? optionsOf(node)[before] : before;
      this.insertBefore(option, next ?? null);
    },
);

const SELECT: Readonly<Record<string, Reflection>> = {
  type: selectType,
  form,
  value: own(
    (node) => selectValue(node) ?? '',
    (node, value) => void setSelect(node, 'value', value, engineOf(node)),
  ),
  selectedIndex: own(selectedIndex, (node, index) => selectAt(node, Number(index), engineOf(node))),
  options: own(optionList),
  length: own((node) => optionsOf(node).length),
  item: own((node) => (at: number) => optionsOf(node)[at] ?? null),
  add: addOption,
  selectedOptions: own((node) => {
    const shown = chosen(node);
    return shown ? [shown] : [];
  }),
};

/** `option.value` and `option.label`: the attribute, or the option's text where there is none. */
const optionText = (attribute: string): Reflection =>
  own(
    (node) => node.getAttribute(attribute) ?? collapsed(textOf(node)),
    (node, value) => node.setAttribute(attribute, String(value)),
  );

const OPTION: Readonly<Record<string, Reflection>> = {
  value: optionText('value'),
  label: optionText('label'),
  selected: own(
    (node) => {
      const select = selectOf(node);
      return select ? chosen(select) === node : node.getAttribute('selected') !== null;
    },
    (node, value) => setSelected(node, !!value, engineOf(node)),
  ),
  index: own((node) => {
    const select = selectOf(node);
    return select ? optionsOf(select).indexOf(node) : 0;
  }),
  form: own((node) => {
    const select = selectOf(node);
    return select ? formOf(select as Reflecting) : null;
  }),
};

/** The properties above, by element and by name. */
export const CONTROLS: Readonly<Record<string, Readonly<Record<string, Reflection>>>> = {
  input: {
    value: inputValue,
    checked,
    indeterminate,
    form,
  },
  textarea: {
    value: textareaValue,
    defaultValue: textareaDefault,
    type: own(() => 'textarea'),
    textLength: own((node) => String(textareaValue.get(node)).length),
    form,
  },
  select: SELECT,
  button: { form },
  fieldset: { form, type: own(() => 'fieldset'), elements: fieldsetElements },
  output: { form, type: own(() => 'output') },
  object: { form },
  option: OPTION,
  form: { elements: formElements, length: own((node) => controlsOf(node).length) },
};

/** A form reset: each control as it was written, before anything was typed, set or checked. */
export function resetControl(node: EngineNode): void {
  checkedness.delete(node);
  indeterminates.delete(node);
  values.delete(node);
  const text = node.tag === 'textarea' ? textOf(node) : (node as Reflecting).getAttribute('value');
  resetField(node, text ?? '', engineOf(node));
}
