import { viewNameOf, type Engine, type EngineNode } from '@ng-native/fabric';
import { clickElement } from './activation.ts';
import { attributeOf } from './element-tree.ts';
import { engineOf } from './window.ts';

/**
 * `focus()`, `blur()` and `click()` as a browser's element has them.
 *
 * Focus is given at once, with its events, before `focus()` returns. A library focuses a field
 * and closes its list in the next statement; native answers a moment after, and the engine passes
 * that answer over, since the field already has the focus. Anything else that takes the focus, a
 * button or what has a `tabindex`, has it as the engine has a field's: the active element and
 * `:focus`, with its events, and native told to blur a field that had it. A focus trap moves it
 * between them and reads where it is.
 *
 * ponytail: a field native then refuses the focus to, a disabled one, is taken to have it until
 * the next focus or blur. Check what native says if one is seen to matter.
 */

/** The platform's text field, which takes the cursor and gives it up when native says so. */
const TEXT_FIELDS = new Set(['TextInput', 'AndroidTextInput']);

/** Whether an element is the platform's text field. */
export const isTextField = (node: EngineNode): boolean =>
  node.nodeKind === 'element' && TEXT_FIELDS.has(viewNameOf(node));

/** What takes the focus with no `tabindex` written, unless it is disabled. */
const FOCUSED_UNASKED = new Set(['button', 'input', 'select', 'textarea', 'summary', 'iframe']);

/** Whether an element takes the focus: one of those, a link that goes somewhere, or a `tabindex`. */
function focusable(node: EngineNode): boolean {
  if (node.nodeKind !== 'element') return false;
  if (Number.isInteger(Number.parseInt(attributeOf(node, 'tabindex') ?? '', 10))) return true;
  const name = (node as unknown as { localName?: string }).localName ?? node.tag;
  if (name === 'a' || name === 'area') return attributeOf(node, 'href') !== null;
  return FOCUSED_UNASKED.has(name) && attributeOf(node, 'disabled') === null;
}

/**
 * Take the focus off what has it: a field by native, which tells the engine once it has, and
 * anything else here, with its blur.
 */
function giveUpFocus(engine: Engine, node: EngineNode): void {
  if (isTextField(node)) engine.dispatchCommand(node, 'blur');
  else engine.dispatchEvent(node, 'topBlur', {});
}

/** Focus an element as `focus()` does: see above. */
function focus(node: EngineNode): void {
  const engine = engineOf(node);
  if (engine.focused === node) return;
  const had = engine.focused;
  if (isTextField(node)) {
    // A field after a field is native's to move; after a button, the button blurs here.
    if (had && !isTextField(had)) giveUpFocus(engine, had);
    engine.focus(node);
    engine.dispatchEvent(node, 'topFocus', {});
    return;
  }
  if (focusable(node)) {
    if (had) giveUpFocus(engine, had);
    engine.dispatchEvent(node, 'topFocus', {});
  }
  // Brought into sight, as a browser scrolls to what it focuses: see `Engine.focus`.
  engine.focus(node);
}

const method = (value: (this: EngineNode) => unknown) => ({ value, writable: true });

/** The members, for every node. */
export const focusMembers: PropertyDescriptorMap = {
  focus: method(function () {
    focus(this);
  }),
  // A field's is given up by native, which says when it has.
  blur: method(function () {
    const engine = engineOf(this);
    if (engine.focused === this) giveUpFocus(engine, this);
  }),
  // A click, which does what a press does: see `activation.ts`.
  click: method(function () {
    clickElement(this);
  }),
};
