import type { Engine, EngineNode } from '@ng-native/fabric';
import type { RendererExtension } from '@ng-native/platform';
import { activate, ancestry, clickElement, disabled } from './activation.ts';
import { documentOf, heldForMenu, listenAnywhere, type CompatDocument } from './document.ts';
import { isTextField } from './element-focus.ts';
import { giveRole, hoverWritten, scrollWhereStyled } from './elements.ts';
import { nativeEvent } from './event-classes.ts';
import { listen, type Heard } from './events.ts';
import {
  FIELD_EVENTS,
  createField,
  isField,
  keyOf,
  refuseEdit,
  setField,
  wasRefused,
} from './field.ts';
import { fenceUnder } from './fieldset.ts';
import { implicitSubmit } from './form.ts';
import { setChecked } from './form-controls.ts';
import { buildAs, holdIconBox, setMarkup } from './html.ts';
import { inlineStyle } from './inline-style.ts';
import { labelPress, setLabel } from './label.ts';
import { MOUSE_OF_TOUCH, TOUCH_EVENTS, asMouse, heardTouch } from './mouse-after-touch.ts';
import { styleMade } from './runtime-style.ts';
import {
  createSelect,
  isSelect,
  optionInserted,
  optionRemoved,
  pressSelect,
  setSelect,
} from './select.ts';
import { engineOf } from './window.ts';
import { together } from './mutation-observer.ts';
import { setSvg, stopChanged, svgInserted, svgNamed, wordsInSpans } from './svg.ts';
import { styleShape } from './svg-box.ts';

/** Elements whose own component already turns a touch into a press. */
const PRESSABLES = new Set(['pressable', 'touchable-opacity']);

/** The native event a listener's own element is being told, while it is told it. */
let current: unknown;

/** The native event an element's listener is being told now: see `listenAnywhere`. */
export const delivering = (): unknown => current;

/** Tell an element's listener of a native event, which is the one being delivered until it is told. */
function deliverAs<T>(event: unknown, tell: () => T): T {
  const outer = current;
  current = event;
  try {
    return tell();
  } finally {
    current = outer;
  }
}

/**
 * What an attribute or a property of any element is set as, in an app that asked for the
 * package. Each answers whether that is all of it.
 */
const SETTERS: Readonly<
  Record<string, (node: EngineNode, value: unknown, engine: Engine) => boolean>
> = {
  // A binding to `textContent` replaces what the element holds with the text.
  textContent(node, value) {
    (node as unknown as { textContent: unknown }).textContent = value;
    return true;
  },
  // A binding to `innerHTML` replaces what the element holds with what the markup is. But for
  // an icon's, set on a `<template>` and long, which `@ng-native/icons` draws from its name.
  innerHTML(node, value, engine) {
    if (node.tag === 'template') holdIconBox(node, engine);
    else together(node, () => setMarkup(node, value, engine));
    return true;
  },
  // HTML's `hidden` bound to `false` is no attribute: the element has none to read back. A
  // hidden element is drawn as `display: none`: see `hide`.
  // A template's `[checked]` is the checkbox's state, as a script's `checked` is, and kept as the
  // attribute, which is there or not: see `form-controls.ts`.
  checked(node, value, engine) {
    if (node.tag !== 'input') return false;
    setChecked(node, on(value));
    engine.setProp(node, 'checked', on(value) ? '' : null);
    return true;
  },
  hidden(node, value, engine) {
    engine.setProp(node, 'hidden', value === false ? null : value);
    hide(node, on(value) && value !== 'until-found', engine);
    return true;
  },
  // An HTML `id` is the view's `nativeID`, which is where a lookup reads it, and the name a
  // shape's clip or gradient is found by in a drawing.
  id(node, value, engine) {
    setSvg(node, 'id', value, engine);
    engine.setProp(node, 'nativeID', value);
    return true;
  },
  // HTML's `disabled` is announced, as `aria-disabled` is, beside the element's other states.
  // Kept as written too: `:disabled` is the attribute, and a press reads it.
  //
  // ponytail: an `aria-disabled` the library wrote itself is replaced, with the same answer
  // wherever the two agree. Keep the library's apart if one is found that differs.
  disabled(node, value, engine) {
    // A fieldset disables the fields in it, once it has the attribute: see `fieldset.ts`.
    if (node.tag === 'fieldset') {
      engine.setProp(node, 'disabled', value);
      fenceUnder(node, engine);
    }
    const off = on(value);
    if (off || announced.has(node)) engine.setProp(node, 'aria-disabled', off ? true : null);
    if (off) announced.add(node);
    else announced.delete(node);
    return false;
  },
  // A `data-hover` the app writes is its own, which a pointer leaving does not take away.
  'data-hover'(node) {
    hoverWritten(node);
    return false;
  },
};

/** The elements whose `disabled` this set an `aria-disabled` for, to take it away again. */
const announced = new WeakSet<EngineNode>();

/** Whether an element's `aria-disabled` is the one its `disabled` announces, and no attribute. */
export const announcesDisabled = (node: EngineNode): boolean => announced.has(node);

/**
 * How a listener a web library adds is attached, in an app that asked for this package.
 *
 * - `'window'`, `'document'` and `'body'` hear a press anywhere in the app.
 * - A `click` is a press: the node takes the touch as a pressable does, and the listener runs when
 *   the finger lifts. Native has no click of its own for a view to hear.
 *
 * ponytail: a lift outside the node still clicks, and nothing is highlighted while it is held.
 * A pressable's own hit testing is the upgrade.
 */
export const webListen: RendererExtension = {
  // An element written inside an `<svg>` is the drawing's, in an app that asked for the package:
  // see `svg.ts`. Another app's is its own.
  named: (name, namespace, engine) => (documentOf(engine) ? svgNamed(name, namespace) : undefined),
  // A button and a link have their roles, and take a press with no listener: see `elements.ts`.
  created(node, engine) {
    if (giveRole(node, engine)) takesPress(engine, node);
    // An input and a text area are the platform's text field, and a select opens a list of its
    // options when pressed: see `field.ts` and `select.ts`.
    createField(node, engine);
    if (isField(node)) submitOnReturn(engine, node);
    if (createSelect(node, engine)) onTouch(engine, node, 'click', () => pressSelect(node, engine));
    // What overflows it scrolls, where its style says so: see `elements.ts`.
    scrollWhereStyled(node, engine);
    // A drawing's text has its words drawn by a span: see `wordsInSpans`.
    wordsInSpans(node);
    // A stylesheet is read, and has no box of its own: see `runtime-style.ts`.
    if (node.tag === 'style' && documentOf(engine)) styleMade(node, engine);
  },
  // What a select shows, and whether a field is in a disabled fieldset, follow where an option
  // and a field are put: see `select.ts` and `fieldset.ts`. What a drawing's own elements are
  // given as they are put in it goes with them as the engine takes them out: see `svg.ts` and
  // `hearRemovals`.
  inserted(node, parent, engine) {
    if (!documentOf(engine)) return;
    optionInserted(node, parent, engine);
    if (node.tag === 'legend' && parent.tag === 'fieldset') fenceUnder(parent, engine);
    else fenceUnder(node, engine);
    svgInserted(node, parent, engine);
  },
  removed(node, engine) {
    optionRemoved(node, engine);
  },
  set(node, name, value, engine) {
    if (!documentOf(engine)) return false;
    // A checkbox, a radio or a button an input is takes a press, and a label's `for` its
    // control's: both are kept as written as well.
    checkControl(node, name, value, engine);
    setLabel(node, name, value, engine);
    const own = SETTERS[name];
    // An attribute of a shape in a drawing is what it draws: see `setSvg`.
    const took = own ? own(node, value, engine) : setSvg(node, name, value, engine);
    // A field's and a select's own: see `field.ts` and `select.ts`.
    return setSelect(node, name, value, engine) || setField(node, name, value, engine) || took;
  },
  // A style a library binds is set as what a native view reads: see `inline-style.ts`. A
  // gradient's stop is given its colour as a style as often as an attribute, and a shape's paint
  // and font are its own: see `svg-box.ts`.
  style(node, name, value, engine) {
    if (!documentOf(engine)) return undefined;
    if (node.tag === 'stop') stopChanged(node, engine);
    if (styleShape(node, name, value, engine)) return {};
    return inlineStyle(node, name, value);
  },
  // Kept as `addEventListener` keeps a listener, so what a script sends reaches a template's too.
  listen(target, eventName, callback, engine) {
    const document = documentOf(engine);
    if (!document) return undefined;
    const on = listenedOn(target, document);
    // An element native says nothing of the event for is given it by the name native would.
    const node = typeof target !== 'string' && on !== globalThis && on !== document;
    const attach = (heard: Heard) =>
      listenNatively(target, eventName, heard, engine) ??
      (node
        ? engine.setEventListener(target as EngineNode, topLevel(eventName), heard)
        : undefined);
    return listen(on, eventName, callback, undefined, attach) ?? (() => {});
  },
};

// What markup builds is given what a template's elements are, as they are made: see `html-tree.ts`.
buildAs(webListen);

/** What a template's listener is on: Angular names the window, the document and the body. */
function listenedOn(target: EngineNode | string, document: CompatDocument): EngineNode | object {
  if (typeof target !== 'string') return target;
  if (target === 'window') return globalThis;
  return target === 'body' ? document.body : document;
}

export const topLevel = (name: string) => 'top' + name.charAt(0).toUpperCase() + name.slice(1);

/**
 * Attach a listener to what native says for an event: on `window`, `document` and `body` a
 * press anywhere, and on an element what it says itself. Nothing where native says nothing of
 * the event.
 */
export function listenNatively(
  target: EngineNode | string,
  eventName: string,
  callback: Heard,
  engine: Engine,
): (() => void) | undefined {
  const document = documentOf(engine);
  if (!document) return undefined;
  // `window`, `document` and `body` by name, or the objects themselves, which is what a library
  // that holds one hands the renderer.
  const anywhere = typeof target === 'string' || target === (globalThis as unknown);
  if (anywhere || target === document.body || target === (document as unknown)) {
    return listenAnywhere(engine, eventName, callback);
  }
  return listenOn(engine, target, eventName, callback);
}

/**
 * Listen on one element: a field's own events, a touch as a pointer or a click, or a native event
 * by its name.
 */
function listenOn(
  engine: Engine,
  target: EngineNode,
  eventName: string,
  callback: Heard,
): (() => void) | undefined {
  const changed = listenToChange(engine, target, eventName, callback);
  if (changed) return changed;
  const field = isField(target) ? FIELD_EVENTS[eventName] : undefined;
  if (field === KEY_PRESS) return listenToKeys(engine, target, eventName, callback);
  if (field) return listenToNative(engine, target, eventName, field, callback);
  if (POINTER_EVENTS.has(eventName)) return onTouch(engine, target, eventName, callback);
  const native = NATIVE_NAMES[eventName];
  if (native) return listenToNative(engine, target, eventName, native, callback);
  if (eventName !== 'click' || PRESSABLES.has(target.tag)) return undefined;
  return onTouch(engine, target, 'click', callback);
}

/**
 * `change` on an input: the end of editing for a text field, and a press for a checkbox or a
 * radio. Which it is goes by its type, which a binding sets after the listener is added, so both
 * are listened for and the one that is the input's own at the time is told.
 */
function listenToChange(
  engine: Engine,
  target: EngineNode,
  eventName: string,
  callback: Heard,
): (() => void) | undefined {
  if (target.tag !== 'input' || eventName !== 'change') return undefined;
  const tell = (field: boolean) => (event: unknown) => {
    if (isField(target) !== field) return;
    deliverAs(event, () => callback(dom('change', target, event)));
  };
  const stops = [
    engine.setEventListener(target, FIELD_EVENTS['change']!, tell(true)),
    engine.setEventListener(target, 'topChange', tell(false)),
  ];
  return () => stops.forEach((stop) => stop());
}

const KEY_PRESS = 'topKeyPress';
/** When each field last said Enter was pressed, as a key: a submit just after is that press. */
const entered = new WeakMap<EngineNode, number>();
/** When a listener last stopped Enter in each field: a return just after submits no form. */
const stoppedEnter = new WeakMap<EngineNode, number>();

/**
 * Return in a field of one line: its form is submitted as a browser submits it, once every
 * listener has heard the Enter key, unless one stopped it. See `implicitSubmit`.
 */
function submitOnReturn(engine: Engine, node: EngineNode): void {
  if (node.tag !== 'input') return;
  engine.setEventListener(node, 'topSubmitEditing', () => {
    queueMicrotask(() => {
      const stopped = Date.now() - (stoppedEnter.get(node) ?? -Infinity) < 100;
      stoppedEnter.delete(node);
      if (isField(node) && !stopped) implicitSubmit(node);
    });
  });
}

/** How many listeners each field of one line has for its keys. */
const keyed = new WeakMap<EngineNode, number>();

/**
 * Tell a field's listener of each key: `keydown` as native says it was pressed, and `keyup`
 * after every listener has heard it down, since native says the two as one press.
 *
 * Return in a field of one line is no key press to native but a submit, which is told as the
 * Enter key. Native also takes the focus from the field as it submits, and the keyboard with
 * it, where a browser leaves both: a library that hears the keys makes something of what was
 * typed and goes on typing. So a field of one line keeps the focus on return for as long as
 * anything listens to its keys, and is as native has it otherwise.
 */
function listenToKeys(
  engine: Engine,
  target: EngineNode,
  eventName: string,
  callback: Heard,
): () => void {
  /** Tell the listener, answering whether it stopped a key it heard go down. */
  const tell = (event: unknown): boolean => {
    const told = dom(eventName, target, event);
    if (eventName === 'keyup') queueMicrotask(() => void deliverAs(event, () => callback(told)));
    else deliverAs(event, () => callback(told));
    return (told as { defaultPrevented: boolean }).defaultPrevented;
  };
  const stops = [
    engine.setEventListener(target, KEY_PRESS, (event) => {
      const key = (event as { nativeEvent?: { key?: unknown } }).nativeEvent?.key;
      if (key === 'Enter') entered.set(target, Date.now());
      const stopped = tell(event);
      if (stopped && key === 'Enter') stoppedEnter.set(target, Date.now());
      // ponytail: return alone, in a field of several lines, which is what a composer stops.
      // Any other key stopped is still typed: refuse those too if a library filters keys.
      if (stopped && key === 'Enter' && target.tag === 'textarea') refuseEdit(target);
    }),
    engine.setEventListener(target, 'topSubmitEditing', () => {
      if (Date.now() - (entered.get(target) ?? 0) < 100) return;
      if (tell({ nativeEvent: { key: 'Enter' } })) stoppedEnter.set(target, Date.now());
    }),
    keepsFocus(engine, target),
  ];
  return () => stops.forEach((stop) => stop());
}

/** Count a listener to the keys of a field of one line, which keeps its focus on return while any is. */
function keepsFocus(engine: Engine, target: EngineNode): () => void {
  if (target.tag !== 'input') return () => {};
  const count = (by: number) => {
    const now = (keyed.get(target) ?? 0) + by;
    keyed.set(target, now);
    engine.setProp(target, 'submitBehavior', now > 0 ? 'submit' : null);
  };
  count(1);
  return () => count(-1);
}

/** Listen for what native says by the name it has, a touch or the mouse a touch is among them. */
function listenToNative(
  engine: Engine,
  target: EngineNode,
  eventName: string,
  native: string,
  callback: Heard,
): () => void {
  const tell = (event: unknown) =>
    wasRefused(event) ? undefined : deliverAs(event, () => callback(dom(eventName, target, event)));
  if (MOUSE_OF_TOUCH.has(eventName)) {
    // The mouse a touch is, told as a browser tells it: see `mouse-after-touch.ts`.
    return engine.setEventListener(target, native, (event) => {
      const told = dom(eventName, target, event);
      asMouse(engine, eventName, event, () => void deliverAs(event, () => callback(told)));
    });
  }
  const stop = engine.setEventListener(target, native, tell);
  if (!TOUCH_EVENTS.has(eventName)) return stop;
  // A touch listener is counted, so a mouse listener knows the page hears touches itself.
  const counted = heardTouch(engine, target);
  return () => {
    counted();
    stop();
  };
}

/** A boolean HTML attribute or property: present, and not `false`. */
const on = (value: unknown): boolean => value != null && value !== false && value !== 'false';

/** The `display` each hidden element had of its own before it was hidden, as `{ display }`. */
const shownAs = new WeakMap<EngineNode, { readonly display: unknown }>();

/**
 * HTML's `hidden`: the element takes no space and draws nothing, whatever a stylesheet says of
 * its display, which is what a browser's own sheet and every reset make of it. Shown again, it
 * has the display of its own it had, or none.
 *
 * ponytail: `until-found` keeps its box, as a browser has it, and is drawn too, where a browser
 * skips what is in it. A collapsible gives it no height and clips it while it is closed, and
 * measures it as it opens. And a display a binding sets while it is hidden shows it.
 */
function hide(node: EngineNode, gone: boolean, engine: Engine): void {
  const had = shownAs.get(node);
  if (gone === (had !== undefined)) return;
  const style = { ...(node.props['style'] as Record<string, unknown> | undefined) };
  if (gone) {
    shownAs.set(node, { display: style['display'] });
    style['display'] = 'none';
  } else {
    shownAs.delete(node);
    if (had!.display === undefined) delete style['display'];
    else style['display'] = had!.display;
  }
  engine.setProp(node, 'style', style);
}

/**
 * Events a browser has another name for than native does. A finger on an element is what a
 * library listens for where it knows it is on a phone, as Material's tooltip does.
 *
 * ponytail: `focusin` and `focusout` are heard on the element that has the focus, and do not go
 * on up to the elements it is in. Send them up as a click is if a library listens from above.
 */
const NATIVE_NAMES: Readonly<Record<string, string>> = {
  scroll: 'topScroll',
  touchstart: 'topTouchStart',
  touchmove: 'topTouchMove',
  touchend: 'topTouchEnd',
  touchcancel: 'topTouchCancel',
  // A touch is the mouse going down and up too, on the element it is on: a handle that is
  // dragged starts on its own `mousedown`.
  mousedown: 'topTouchStart',
  mouseup: 'topTouchEnd',
  // A form's own, said from a press on one of its buttons: see `activation.ts`.
  submit: 'topSubmit',
  reset: 'topReset',
  focusin: 'topFocus',
  focusout: 'topBlur',
  focus: 'topFocus',
  blur: 'topBlur',
};

/** The events a touch is delivered as, beside the `click` its release is. */
const POINTER_EVENTS = new Set([
  ...['pointerdown', 'pointermove', 'pointerup', 'pointercancel'],
  'contextmenu',
]);

/** How long a finger is held for a context menu, and how far it may drift: the platforms' own. */
const HOLD = 500;
const SLOP = 10;

type Listener = (event: unknown) => boolean | void;

/** A node's listeners by event type, with what stops its responder: a node has one responder. */
interface Touched {
  readonly listeners: Map<string, Set<Listener>>;
  readonly stop: () => void;
}

const touched = new WeakMap<EngineNode, Touched>();

/**
 * The nodes a touch is on: the one that took it and the one it landed on. A touch goes to the node
 * that took it until it ends, which is what a pointer capture asks a browser for.
 */
const capturing = new WeakSet<EngineNode>();

/** Whether a touch is on the node, and so every move of it comes to the node's listeners. */
export const hasCapture = (node: EngineNode): boolean => capturing.has(node);

/** Where on the screen a touch is. */
function pointOf(event: unknown): { x: number; y: number } {
  const touch = (event as { nativeEvent?: { pageX?: number; pageY?: number } }).nativeEvent;
  return { x: touch?.pageX ?? 0, y: touch?.pageY ?? 0 };
}

/** The node's listeners, behind a responder it gets the first time it is asked for. */
function touchedOf(engine: Engine, node: EngineNode): Touched {
  let entry = touched.get(node);
  if (entry) return entry;
  const listeners = new Map<string, Set<Listener>>();
  /** Where the touch landed: the node, or one inside it with no responder of its own. */
  let landed = node;
  let down = { x: 0, y: 0 };
  /** Whether the finger went further than a press does: a drag, which ends in no click. */
  let dragged = false;
  /** The wait for a finger held still, and whether it ran out: the hold was a context menu. */
  let holding: ReturnType<typeof setTimeout> | undefined;
  let menu = false;
  const tell = (type: string, event: unknown) => {
    const told = listeners.get(type);
    if (!told?.size && type !== 'click') return;
    // A click is a pointer event too, on the node that took the touch.
    const sent = pointer(type, type === 'click' ? node : landed, node, event) as Bubbling;
    deliverAs(event, () => deliver(node, type, told, sent));
  };
  /** A finger held where it landed is what asks for a context menu with no second button. */
  const hold = (event: unknown) => {
    holding = setTimeout(() => {
      menu = true;
      // Until the next touch, wherever it lands: lifting this finger is no click anywhere.
      heldForMenu.add(engine);
      const stop = engine.setEventListener(engine.root, 'topTouchStart', () => {
        heldForMenu.delete(engine);
        stop();
      });
      tell('contextmenu', event);
    }, HOLD);
  };
  const over = (type: string, event: unknown) => {
    clearTimeout(holding);
    tell(type, event);
    capturing.delete(node);
    capturing.delete(landed);
  };
  const stop = engine.setResponder(node, {
    onStartShouldSetResponder: (_event, target) => {
      if (disabled(node)) return false;
      landed = target ?? node;
      return true;
    },
    onResponderGrant: (event) => {
      capturing.add(node);
      capturing.add(landed);
      dragged = false;
      menu = false;
      down = pointOf(event);
      tell('pointerdown', event);
      if (listeners.get('contextmenu')?.size) hold(event);
    },
    onResponderMove: (event) => {
      const at = pointOf(event);
      if (Math.hypot(at.x - down.x, at.y - down.y) > SLOP) {
        clearTimeout(holding);
        dragged = true;
      }
      tell('pointermove', event);
    },
    onResponderRelease: (event) => {
      over('pointerup', event);
      // A hold that opened a menu is not a press as well, nor is a drag: a list moved under a
      // finger is not the option it was lifted from.
      const at = pointOf(event);
      dragged ||= Math.hypot(at.x - down.x, at.y - down.y) > SLOP;
      if (!disabled(node) && !menu && !dragged) tell('click', event);
    },
    onResponderTerminate: (event) => over('pointercancel', event),
  });
  touched.set(node, (entry = { listeners, stop }));
  return entry;
}

interface Bubbling {
  currentTarget: EngineNode;
  stopped?: boolean;
  defaultPrevented?: boolean;
}

/** Tell a node's listeners of what a touch was, and those above it of a click or a pointer down. */
function deliver(node: EngineNode, type: string, told: Set<Listener> | undefined, sent: Bubbling) {
  // What the click does, as a click a script sends does it: see `activation.ts`.
  const activated = type === 'click' ? activate(ancestry(node), true) : undefined;
  // A copy: a listener may remove itself, or another, as it runs.
  for (const each of [...(told ?? [])]) each(sent);
  // A click bubbles, and so does a pointer coming down, which is where a drag starts: an area
  // told of it follows the finger from the document, though it came down on a thumb inside it.
  if (type === 'click' || type === 'pointerdown') bubble(node, sent, type);
  activated?.(!sent.defaultPrevented);
}

/**
 * Send a click or a pointer down on up the tree, to each node over the one that took the touch
 * that listens for one, until a listener stops it: only one node takes a touch, and a browser's
 * click is heard by every box it is in.
 */
function bubble(from: EngineNode, event: Bubbling, type: string): void {
  for (let up = from.parent; up && !event.stopped; up = up.parent) {
    const told = touched.get(up)?.listeners.get(type);
    if (!told?.size || disabled(up)) continue;
    event.currentTarget = up;
    for (const each of [...told]) each(event);
  }
}

/** The inputs a press does something on: see `activation.ts`. */
const PRESSED_INPUTS = new Set(['checkbox', 'radio', 'submit', 'image', 'reset']);

/**
 * A checkbox, a radio or a button an input is, which a library keeps out of sight under one it
 * draws: it takes the touch, and what a press on it does is in `activation.ts`. Of any other
 * type, or of none, it lets the touch go again.
 */
function checkControl(node: EngineNode, name: string, value: unknown, engine: Engine): void {
  if (name !== 'type' || node.tag !== 'input') return;
  if (PRESSED_INPUTS.has(String(value))) takesPress(engine, node);
  else letGoOfPress(node);
}

// A label's control clicked as `click()` clicks it. One typed into is focused instead, and a
// select opens its list, as a press on it does.
labelPress.click = (control) => {
  if (isTextField(control)) return false;
  if (isSelect(control)) {
    if (!disabled(control)) pressSelect(control, engineOf(control));
    return true;
  }
  if (!disabled(control)) clickElement(control);
  return true;
};

/**
 * Have a node take the touch whether or not anything listens for its click, as a button or a
 * link does in a browser: it is `:active` while held, which is where its pressed style comes from.
 */
export function takesPress(engine: Engine, node: EngineNode): void {
  held.add(touchedOf(engine, node));
}

/** The entries `takesPress` made, which keep their responder with no listener left. */
const held = new WeakSet<object>();

/** Have a node no longer take the touch for its own sake: only for as long as a listener asks. */
function letGoOfPress(node: EngineNode): void {
  const entry = touched.get(node);
  if (!entry || !held.delete(entry)) return;
  if ([...entry.listeners.values()].some((each) => each.size)) return;
  touched.delete(node);
  entry.stop();
}

/** Add a click or pointer listener to a node, which takes the touch for as long as it has one. */
function onTouch(engine: Engine, node: EngineNode, type: string, listener: Listener): () => void {
  const entry = touchedOf(engine, node);
  const { listeners, stop } = entry;
  let told = listeners.get(type);
  if (!told) listeners.set(type, (told = new Set()));
  told.add(listener);
  return () => {
    told.delete(listener);
    const left = [...listeners.values()].some((each) => each.size);
    if (left || held.has(entry) || touched.get(node) !== entry) return;
    touched.delete(node);
    stop();
  };
}

interface Touch {
  identifier?: number;
  pageX?: number;
  pageY?: number;
}

/** A touch as a DOM `Touch` reads: the page and the client both, with no window to scroll. */
const asTouch = (touch: Touch): object => ({
  ...touch,
  clientX: touch.pageX ?? 0,
  clientY: touch.pageY ?? 0,
});

/** A list of touches, which a library reads one of by its place: `touches.item(0)`. */
const touchList = (touches: readonly Touch[] | undefined): object[] => {
  const list = (touches ?? []).map(asTouch);
  return Object.assign(list, { item: (index: number) => list[index] ?? null });
};

/**
 * Where a touch is, as a DOM event says it: the finger that changed at the page and the client,
 * and the fingers down as `touches`.
 */
export function touchFields(native: unknown): Record<string, unknown> {
  const said = native as
    { pageX?: number; pageY?: number; touches?: Touch[]; changedTouches?: Touch[] } | undefined;
  if (!said) return {};
  const x = said.pageX ?? 0;
  const y = said.pageY ?? 0;
  return {
    clientX: x,
    clientY: y,
    pageX: x,
    pageY: y,
    touches: touchList(said.touches),
    changedTouches: touchList(said.changedTouches),
  };
}

/**
 * A pointer event as a listener reads one: where the finger is, and which pointer it is. Of the
 * kind a browser sends it as, a `PointerEvent`: see `event-classes.ts`.
 */
function pointer(type: string, target: EngineNode, current: EngineNode, event: unknown): object {
  const touch = (event as { nativeEvent?: { identifier?: number } }).nativeEvent;
  return nativeEvent(type, {
    ...domFields(type, target, event),
    currentTarget: current,
    pointerId: touch?.identifier ?? 0,
    pointerType: 'touch',
    isPrimary: true,
    // How many presses a click is, which is none for a pointer event.
    detail: type === 'click' ? 1 : 0,
    ...noKeysHeld(type),
  });
}

/**
 * The button of a mouse event a touch is, and no key held with a finger: a listener that leaves a
 * modified click to the browser reads these, as a router's link does.
 */
function noKeysHeld(type: string): object {
  return {
    button: 0,
    buttons: type === 'pointerdown' || type === 'pointermove' || type === 'mousedown' ? 1 : 0,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
  };
}

/** A DOM event as a listener reads one, of the kind a browser sends it as. */
function dom(type: string, target: EngineNode, event: unknown): object {
  const fields = domFields(type, target, event);
  const mouse = MOUSE_OF_TOUCH.has(type);
  return nativeEvent(type, mouse ? { ...fields, ...noKeysHeld(type), detail: 1 } : fields);
}

/** What native said of events a listener has cancelled. */
const cancelled = new WeakSet<object>();

/** Whether a listener cancelled the event native said, or this package sent as native would. */
export const wasCancelled = (native: object): boolean => cancelled.has(native);

/** What a DOM event says of itself: its type, its target, and the native event behind it. */
function domFields(type: string, target: EngineNode, event: unknown): Record<string, unknown> {
  // What native said, which every element the event goes up through is told of.
  const native = (event as { nativeEvent?: object } | undefined)?.nativeEvent;
  return {
    ...touchFields(native),
    // The key a field says was pressed: see `field.ts`.
    ...keyOf(native as { key?: unknown } | undefined),
    type,
    // What the event was sent to, which a listener on a box around it tells from that box.
    target: (event as { target?: EngineNode | null } | undefined)?.target ?? target,
    currentTarget: target,
    nativeEvent: event,
    defaultPrevented: cancelled.has(native ?? {}),
    preventDefault(this: { defaultPrevented?: boolean }) {
      this.defaultPrevented = true;
      if (native) cancelled.add(native);
    },
    stopPropagation(this: { stopped?: boolean }) {
      this.stopped = true;
      // And the native event the engine carries on up to the boxes around the target.
      (event as { stopPropagation?(): void } | undefined)?.stopPropagation?.();
    },
  };
}
