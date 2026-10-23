import { isTextInput, type Engine, type EngineNode } from '@ng-native/fabric';
import { clickElement, disabled } from './activation.ts';
import { eventPath } from './document.ts';
import { dispatch, newEvent } from './events.ts';
import { isFileInput, pickFiles } from './file-input.ts';
import { attributeOf } from './element-tree.ts';
import { deliveringAnAction } from './listen.ts';
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
 * A field's blur is given at once too, so it can be focused again in the next statement, and the
 * blur native answers with a moment later is passed over: see `passOverToldBlurs`.
 *
 * ponytail: a field native then refuses the focus to, a read-only one, is taken to have it until
 * the next focus or blur. Check what native says if one is seen to matter.
 */

/** What takes the focus with no `tabindex` written. */
const FOCUSED_UNASKED = new Set(['button', 'input', 'select', 'textarea', 'summary', 'iframe']);

/** The controls a `disabled` takes the focus from, a `tabindex` or not. */
const DISABLED_BY_ATTRIBUTE = new Set(['button', 'input', 'select', 'textarea']);

const nameOf = (node: EngineNode): string =>
  (node as unknown as { localName?: string }).localName ?? node.tag;

/**
 * Whether an element is a control that is disabled: by its attribute, or the platform's field by
 * the state it announces, which is where its `disabled` input goes.
 */
function isDisabled(node: EngineNode): boolean {
  if (isTextInput(node)) {
    const state = node.props['accessibilityState'] as { disabled?: unknown } | undefined;
    if (state?.disabled === true) return true;
  }
  return DISABLED_BY_ATTRIBUTE.has(nameOf(node)) && attributeOf(node, 'disabled') !== null;
}

/** Whether an element takes the focus: one of those, a link that goes somewhere, or a `tabindex`. */
function focusable(node: EngineNode): boolean {
  if (node.nodeKind !== 'element') return false;
  if (Number.isInteger(Number.parseInt(attributeOf(node, 'tabindex') ?? '', 10))) return true;
  const name = nameOf(node);
  if (name === 'a' || name === 'area') return attributeOf(node, 'href') !== null;
  return FOCUSED_UNASKED.has(name);
}

/** The fields given up here whose blur native has still to answer with. */
const blurredAhead = new WeakSet<EngineNode>();

/** While this package tells the engine of a focus or a blur itself, which native did not say. */
let telling = false;

function tell(engine: Engine, node: EngineNode, type: 'topFocus' | 'topBlur'): void {
  telling = true;
  try {
    engine.dispatchEvent(node, type, {});
  } finally {
    telling = false;
  }
}

/** Take the focus off what has it, with its blur, and tell native to blur a field. */
function giveUpFocus(engine: Engine, node: EngineNode): void {
  if (isTextInput(node)) {
    blurredAhead.add(node);
    engine.dispatchCommand(node, 'blur');
  }
  tell(engine, node, 'topBlur');
}

/**
 * Pass over the blur native answers a field given up here with, which was told already, and
 * answer what stops. A focus native gives a field of itself, one this package did not ask for,
 * is no answer to it: native says no blur for a field it never had, and the next it says is one.
 */
export function passOverToldBlurs(engine: Engine): () => void {
  const had = Object.getOwnPropertyDescriptor(engine, 'dispatchEvent');
  const dispatch = engine.dispatchEvent;
  const heard: Engine['dispatchEvent'] = function (this: Engine, target, type, event) {
    const node = target as EngineNode | null;
    if (!telling && node && blurredAhead.has(node)) {
      if (type === 'topBlur') return void blurredAhead.delete(node);
      if (type === 'topFocus' && engine.focused !== node) blurredAhead.delete(node);
    }
    dispatch.call(this, target, type, event);
  };
  engine.dispatchEvent = heard;
  return () => {
    if (engine.dispatchEvent !== heard) return;
    if (had) Object.defineProperty(engine, 'dispatchEvent', had);
    else delete (engine as Partial<Engine>).dispatchEvent;
  };
}

/** While `moveBefore` moves a node, which keeps the focus that a removal and an insertion lose. */
let keepsFocus = false;

/** Move a node as `moveBefore` does, keeping the focus in it: see `loseFocusMoving`. */
export function keepingFocus(move: () => void): void {
  keepsFocus = true;
  try {
    move();
  } finally {
    keepsFocus = false;
  }
}

/**
 * Take the focus off an element that is moved, or off the one in it that has it: a browser takes
 * an element out of the tree before it puts it back, and what is taken out is not focused. Told
 * before the node leaves its parent, by whichever takes it out first.
 */
export function loseFocusMoving(node: EngineNode): void {
  if (keepsFocus || !node.parent) return;
  const engine = engineOf(node);
  const had = engine.focused;
  for (let at = had; at; at = at.parent) if (at === node) return giveUpFocus(engine, had!);
}

/** Focus an element as `focus()` does: see above. */
function focus(node: EngineNode, options?: { preventScroll?: unknown }): void {
  const engine = engineOf(node);
  if (engine.focused === node || isDisabled(node)) return;
  const had = engine.focused;
  if (isTextInput(node)) {
    // A field after a field is native's to move; after a button, the button blurs here.
    if (had && !isTextInput(had)) giveUpFocus(engine, had);
    engine.focus(node);
    tell(engine, node, 'topFocus');
    return;
  }
  if (focusable(node)) {
    if (had) giveUpFocus(engine, had);
    tell(engine, node, 'topFocus');
  }
  // Brought into sight, as a browser scrolls to what it focuses (see `Engine.focus`), but only
  // in answer to a touch, a key or an edit, not as what holds it scrolls, and not where the
  // caller says `preventScroll`: a library focuses a
  // panel as its page is built, a question or a focus trap, and a screen that opens part way
  // down for it has moved for nobody.
  //
  // ponytail: a focus from a timer or a promise a touch started is not in answer to it here.
  // Carry the touch through to those if a form is seen not to scroll to what it sends to.
  if (!options?.preventScroll && deliveringAnAction()) engine.focus(node);
}

const method = (value: (this: EngineNode) => unknown) => ({ value, writable: true });

/** The members, for every node. */
export const focusMembers: PropertyDescriptorMap = {
  focus: method(function (options?: { preventScroll?: unknown }) {
    focus(this, options);
  }),
  blur: method(function () {
    const engine = engineOf(this);
    if (engine.focused === this) giveUpFocus(engine, this);
  }),
  // A click, which does what a press does: see `activation.ts`. A file input's is the system's
  // file picker, and its own listeners hear what comes of it, `change` or `cancel`: a library
  // makes the input itself, and never puts it in a template. See `file-input.ts`.
  click: method(function () {
    if (!isFileInput(this)) return clickElement(this);
    if (disabled(this)) return;
    const engine = engineOf(this);
    void pickFiles(this, engine)
      // A picker that fails, open already or with no native module, picked nothing: `cancel`,
      // which is what a library waiting on the input hears for that.
      .catch((failure: unknown) => {
        console.warn('[angular-native] the file picker failed:', failure);
        return 'cancel' as const;
      })
      .then((type) => {
        // What was picked is `input` and then `change`, as a browser tells it.
        const told = type === 'change' ? ['input', 'change'] : ['cancel'];
        for (const each of told)
          dispatch(newEvent(each, { bubbles: true }), eventPath(engine, this));
      });
  }),
};
