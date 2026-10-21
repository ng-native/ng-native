import type { EngineNode } from '@ng-native/fabric';
import { isField } from './field.ts';
import { clickElement } from './activation.ts';
import { controlsOf, resetControl } from './form-controls.ts';
import { wasCancelled } from './listen.ts';
import { method, type Reflection } from './reflect.ts';
import { resetSelect } from './select.ts';
import { checkForm } from './validity.ts';
import { engineOf } from './window.ts';

/**
 * What a form does when it is submitted or reset: from a press on one of its buttons (see
 * `activation.ts`), or from `requestSubmit()` and `reset()`. Each is said to the form's listeners
 * as native would say it, so a template's `(submit)` and a script's listener hear it alike.
 *
 * ponytail: a submit goes nowhere, there being no page to leave, and its event has no
 * `submitter`. A library reads its form's values off the controls in its listener.
 */

const on = (value: unknown): boolean => value != null && value !== false && value !== 'false';

/** Whether a node is in the page: a form out of it is neither submitted nor reset. */
function inPage(node: EngineNode): boolean {
  const root = engineOf(node).root;
  for (let at: EngineNode | null = node; at; at = at.parent) if (at === root) return true;
  return false;
}

/**
 * Submit a form, as a submit button or `requestSubmit()` does: unless one of its controls fails
 * its constraints, each of those told `invalid`, where neither the form nor the button says
 * `novalidate`.
 */
export function submitForm(form: EngineNode, submitter?: EngineNode | null): void {
  if (!inPage(form)) return;
  const unchecked = on(form.props['novalidate']) || on(submitter?.props['formnovalidate']);
  if (!unchecked && !checkForm(form)) return;
  engineOf(form).dispatchEvent(form, 'topSubmit', {});
}

/** Reset a form, unless a listener cancels its `reset`: each control as it was written. */
export function resetForm(form: EngineNode): void {
  if (!inPage(form)) return;
  const said = {};
  const engine = engineOf(form);
  engine.dispatchEvent(form, 'topReset', said);
  if (wasCancelled(said)) return;
  for (const control of controlsOf(form)) {
    resetControl(control);
    resetSelect(control, engine);
  }
}

/** The buttons of a form that submit it: a button of no type is one. */
const isSubmit = (node: EngineNode): boolean => {
  const type = String(node.props['type'] ?? '').toLowerCase();
  if (node.tag === 'button') return type !== 'reset' && type !== 'button';
  return node.tag === 'input' && (type === 'submit' || type === 'image');
};

/**
 * Return in a field of one line, as HTML's implicit submission has it: the form's first submit
 * button is clicked, or, where it has none, the form is submitted if the field is its only one.
 */
export function implicitSubmit(field: EngineNode): void {
  const form = (field as { form?: EngineNode | null }).form;
  if (!form) return;
  const controls = controlsOf(form);
  const button = controls.find(isSubmit);
  if (button) return void clickElement(button);
  // A text area does not count: return in one is a new line.
  if (controls.filter((each) => each.tag === 'input' && isField(each)).length === 1) {
    submitForm(form);
  }
}

/** A form's own methods. */
export const FORM_METHODS: Readonly<Record<string, Readonly<Record<string, Reflection>>>> = {
  form: {
    // Validated, and told to its listeners, as its submit button submits it.
    requestSubmit: method(function (this: EngineNode, submitter?: EngineNode | null) {
      submitForm(this, submitter);
    }),
    // ponytail: no validation and no event, as a browser has it, and nowhere to go after.
    submit: method(function () {}),
    reset: method(function (this: EngineNode) {
      resetForm(this);
    }),
  },
};
