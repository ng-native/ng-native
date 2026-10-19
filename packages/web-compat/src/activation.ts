import type { Engine, EngineNode } from '@ng-native/fabric';
import { activation, dispatch } from './events.ts';
import { CompatMouseEvent, scriptClick } from './event-classes.ts';
import { eventPath } from './document.ts';
import { engineOf } from './window.ts';
import { fenced } from './fieldset.ts';
import { resetForm, submitForm } from './form.ts';
import { groupOf, isChecked, setChecked } from './form-controls.ts';
import { controlOf, pressControl } from './label.ts';

/**
 * What a click does once it has been heard, as a browser's activation behaviour: a checkbox or a
 * radio is checked and says `input` and `change`, a submit or reset button submits or resets its
 * form, and a label clicks its control. A link follows nothing: there is no page to leave.
 *
 * The same for a press, a click a script sends and `element.click()`: a press runs it from
 * `listen.ts`, and anything sent with `dispatchEvent` from `events.ts`. A listener that prevents
 * the click's default cancels it, and a checkbox goes back to what it was.
 *
 * A radio checked unchecks the others of its group, and one that was checked already says nothing.
 * A form is submitted only once its controls pass their constraints: see `form.ts`.
 *
 * ponytail: a form is submitted from a button only: return in one of its fields submits it in
 * a browser too; say so from the field's own submit if a library waits for one.
 */

/** What runs once a click is over, told whether a listener cancelled it. */
export type Activated = (done: boolean) => void;

/** The controls a disabled fieldset around them disables: see `fieldset.ts`. */
const FENCED = new Set(['button', 'input', 'select', 'textarea']);

/**
 * Whether the node has HTML's `disabled`, on which a browser delivers no click, or is a control
 * in a fieldset that does.
 */
export function disabled(node: EngineNode): boolean {
  const value = node.props['disabled'];
  if (value != null && value !== false && value !== 'false') return true;
  return FENCED.has(node.tag) && fenced(node);
}

const CHECKS = new Set(['checkbox', 'radio']);
/** What a button of each type does that is not a submit: a plain button does nothing. */
const BUTTON_ACTIONS: Readonly<Record<string, string | undefined>> = {
  button: undefined,
  reset: 'reset',
};
/** What an `<input>` of each type is to its form: an image is a submit button. */
const INPUT_BUTTONS: Readonly<Record<string, string>> = {
  submit: 'submit',
  image: 'submit',
  reset: 'reset',
};
/** What a press goes to in a browser rather than the label it is in. */
const INTERACTIVE = new Set(['a', 'button', 'input', 'select', 'textarea']);

const typeOf = (node: EngineNode): string => String(node.props['type'] ?? '').toLowerCase();

/** What a button or an input of a button's type does to its form, where it is one. */
function formAction(node: EngineNode): string | undefined {
  // A button of no type, or of one it cannot be, is a submit button.
  if (node.tag === 'button') {
    const type = typeOf(node);
    return type in BUTTON_ACTIONS ? BUTTON_ACTIONS[type] : 'submit';
  }
  return node.tag === 'input' ? INPUT_BUTTONS[typeOf(node)] : undefined;
}

/** Whether a click on the node does something once it is heard. */
export function activates(node: EngineNode): boolean {
  if (node.tag === 'label') return true;
  if (node.tag === 'input' && CHECKS.has(typeOf(node))) return true;
  return formAction(node) !== undefined;
}

/**
 * A checkbox or a radio, checked before any listener hears the click, as a browser checks it: a
 * library with no state of its own reads it off the `change`. Put back if the click was cancelled.
 */
function check(node: EngineNode): Activated {
  const radio = typeOf(node) === 'radio';
  const was = isChecked(node);
  // The radio of the group that was checked, which is checked again if the click is cancelled.
  const before = radio ? groupOf(node as never).find((other) => isChecked(other)) : undefined;
  setChecked(node, radio || !was);
  return (done) => {
    if (!done) {
      setChecked(node, was);
      if (before) setChecked(before, true);
      return;
    }
    const engine = engineOf(node);
    // One not in the page is checked, and says nothing of it, as a browser has it. Nor does a
    // radio that was checked already, which changed nothing.
    if (!ancestry(node).includes(engine.root) || (radio && was)) return;
    engine.dispatchEvent(node, 'topInput', {});
    engine.dispatchEvent(node, 'topChange', {});
  };
}

/**
 * A button's form submitted or reset, unless the click was cancelled, the button was disabled
 * while it was heard, or the form is in no page.
 */
function submit(node: EngineNode, action: string): Activated {
  return (done) => {
    const form = (node as { form?: EngineNode | null }).form;
    if (!done || !form || disabled(node)) return;
    // Validated first, as a browser does: see `form.ts`.
    if (action === 'submit') submitForm(form, node);
    else resetForm(form);
  };
}

/**
 * A label's control clicked, unless the click came from the control or from something else a
 * click is for inside the label: `inside` is the way from the target up to the label.
 */
function label(node: EngineNode, inside: readonly object[]): Activated {
  return (done) => {
    if (!done || inside.some((each) => INTERACTIVE.has((each as EngineNode).tag))) return;
    const engine = engineOf(node);
    const control = controlOf(node, engine);
    if (control && !inside.includes(control)) pressControl(control, engine);
  };
}

/** What a click on the node does, where it does something: see `activates`. */
function behaviourOf(node: EngineNode, inside: readonly object[]): Activated {
  // A disabled checkbox is checked by a click a script sends all the same: none from a finger
  // reaches it, see `listen.ts`.
  if (node.tag === 'input' && CHECKS.has(typeOf(node))) return check(node);
  if (disabled(node)) return () => {};
  if (node.tag === 'label') return label(node, inside);
  return submit(node, formAction(node)!);
}

const isElement = (each: object): each is EngineNode =>
  (each as { nodeKind?: unknown }).nodeKind === 'element';

/**
 * What a click along a path does: the first element on it, from the target up, that does
 * something, where the click bubbles. Its checkbox is checked now; what answers runs the rest.
 */
export function activate(path: readonly object[], bubbles: boolean): Activated | undefined {
  for (let at = 0; at < path.length; at++) {
    if (at > 0 && !bubbles) return undefined;
    const each = path[at]!;
    if (isElement(each) && activates(each)) return behaviourOf(each, path.slice(0, at));
  }
  return undefined;
}

/** The way up from a node to the root of its app. */
export function ancestry(node: EngineNode): EngineNode[] {
  const path: EngineNode[] = [];
  for (let at: EngineNode | null = node; at; at = at.parent) path.push(at);
  return path;
}

/** Whether an event is a mouse event: a click of any other kind does nothing, as in a browser. */
function isMouseEvent(event: object): boolean {
  const Runtime = (globalThis as { MouseEvent?: unknown }).MouseEvent;
  return (
    event instanceof CompatMouseEvent || (typeof Runtime === 'function' && event instanceof Runtime)
  );
}

activation.of = (event, type, path) => {
  if (type !== 'click' || !isMouseEvent(event)) return undefined;
  return activate(path, (event as { bubbles?: boolean }).bubbles === true);
};

/** The elements being clicked by `click()` now, which a second `click()` from a listener skips. */
const clicking = new WeakSet<EngineNode>();

/**
 * `element.click()`: a click sent to the element and everything it is in, as a browser sends
 * one, and what it does after. Nothing for a disabled control, or one being clicked already.
 */
export function clickElement(node: EngineNode, engine: Engine = engineOf(node)): void {
  if (disabled(node) || clicking.has(node)) return;
  clicking.add(node);
  try {
    dispatch(scriptClick(), eventPath(engine, node));
  } finally {
    clicking.delete(node);
  }
}
