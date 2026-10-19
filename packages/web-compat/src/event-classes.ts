import { CompatEvent, eventKinds, initLegacy, isDispatching, sentByNative } from './events.ts';

/**
 * The kinds of event a browser has beside `Event`, for a runtime that has none of them: what a
 * touch, a key, the focus or a field's typing is sent as, each with the members of its init
 * dictionary, read-only, and the legacy `init*Event` that `document.createEvent` is followed by.
 *
 * Each is the runtime's own `Event` underneath where it has one, Node's or React Native's, and
 * this package's where it has none, so `event instanceof Event` holds of every one.
 *
 * ponytail: `DragEvent`, `ClipboardEvent` and the rest are not here. Add one as `KeyboardEvent`
 * is if a library is seen to make one or ask whether an event is one.
 */

type Init = Record<string, unknown> | null | undefined;
type EventClass = new (type: string, init?: Init) => object;

const Base = ((globalThis as { Event?: unknown }).Event ?? CompatEvent) as EventClass;

/** What each event was made with, by the names of its members. */
const fields = new WeakMap<object, Record<string, unknown>>();

const fieldsOf = (event: object): Record<string, unknown> =>
  fields.get(event) ?? fields.set(event, {}).get(event)!;

/** How a value an init dictionary gives is taken, as WebIDL converts it to the member's type. */
type Convert = (value: unknown) => unknown;
const number: Convert = (value) => {
  const made = Number(value);
  return Number.isNaN(made) ? 0 : made;
};
const boolean: Convert = (value) => !!value;
const string: Convert = (value) => String(value);
const nullableString: Convert = (value) => (value == null ? null : String(value));
const object: Convert = (value) => value ?? null;
const view: Convert = (value) => {
  if (value != null && value !== globalThis) {
    throw new TypeError("Failed to construct 'UIEvent': member view is not of type Window.");
  }
  return value ?? null;
};

/** A list of touches, as a browser's `TouchList` is read: by its place, or by `item`. */
function touchList(touches: readonly unknown[] = []): readonly unknown[] {
  const list = [...touches];
  return Object.assign(list, { item: (index: number) => list[index] ?? null });
}
const touches: Convert = (value) => touchList(Array.isArray(value) ? value : []);

/** Each member of an init dictionary: how it is taken, and what it is where none is given. */
type Members = Readonly<Record<string, readonly [Convert, unknown]>>;

/** The keys `getModifierState` answers for, by the member of the init dictionary for each. */
const MODIFIER_KEYS: Readonly<Record<string, string>> = {
  Control: 'ctrlKey',
  Shift: 'shiftKey',
  Alt: 'altKey',
  Meta: 'metaKey',
  AltGraph: 'modifierAltGraph',
  CapsLock: 'modifierCapsLock',
  Fn: 'modifierFn',
  FnLock: 'modifierFnLock',
  Hyper: 'modifierHyper',
  NumLock: 'modifierNumLock',
  ScrollLock: 'modifierScrollLock',
  Super: 'modifierSuper',
  Symbol: 'modifierSymbol',
  SymbolLock: 'modifierSymbolLock',
};
const MODIFIERS: Members = Object.fromEntries(
  Object.values(MODIFIER_KEYS).map((name) => [name, [boolean, false]]),
);
/** The modifiers an event has a member for: the rest are read by `getModifierState` alone. */
const MODIFIER_MEMBERS = ['ctrlKey', 'shiftKey', 'altKey', 'metaKey'];

const UI: Members = { view: [view, null], detail: [number, 0], which: [number, 0] };
const MOUSE: Members = {
  ...MODIFIERS,
  ...Object.fromEntries(
    ['screenX', 'screenY', 'clientX', 'clientY', 'movementX', 'movementY', 'button', 'buttons'].map(
      (name) => [name, [number, 0]],
    ),
  ),
  relatedTarget: [object, null],
};
const POINTER: Members = {
  ...Object.fromEntries(
    ['pointerId', 'pressure', 'tangentialPressure', 'tiltX', 'tiltY', 'twist'].map((name) => [
      name,
      [number, 0],
    ]),
  ),
  width: [number, 1],
  height: [number, 1],
  pointerType: [string, ''],
  isPrimary: [boolean, false],
};
const WHEEL: Members = {
  deltaX: [number, 0],
  deltaY: [number, 0],
  deltaZ: [number, 0],
  deltaMode: [number, 0],
};
const KEYBOARD: Members = {
  ...MODIFIERS,
  key: [string, ''],
  code: [string, ''],
  location: [number, 0],
  repeat: [boolean, false],
  isComposing: [boolean, false],
  charCode: [number, 0],
  keyCode: [number, 0],
};
const FOCUS: Members = { relatedTarget: [object, null] };
const INPUT: Members = {
  data: [nullableString, null],
  isComposing: [boolean, false],
  inputType: [string, ''],
  dataTransfer: [object, null],
};
const DATA: Members = { data: [string, ''] };
const TOUCH_EVENT: Members = {
  ...MODIFIERS,
  touches: [touches, touchList()],
  targetTouches: [touches, touchList()],
  changedTouches: [touches, touchList()],
};

/** Keep what an init dictionary says of each member, or what the member is where it is silent. */
function take(event: object, init: Init, members: Members): void {
  const given = init ?? {};
  const own = fieldsOf(event);
  for (const [name, [convert, otherwise]] of Object.entries(members)) {
    own[name] = given[name] === undefined ? otherwise : convert(given[name]);
  }
}

/** Throw as a browser's constructor does when it is not given the event's type. */
function typed(count: number, name: string): void {
  if (count === 0) {
    throw new TypeError(`Failed to construct '${name}': 1 argument required, but only 0 present.`);
  }
}

/** Read-only members on a kind's prototype, over what each event was made with. */
function readOnly(kind: EventClass, names: readonly string[]): void {
  for (const name of names) {
    Object.defineProperty(kind.prototype, name, {
      get(this: object) {
        return fields.get(this)?.[name];
      },
      configurable: true,
      enumerable: true,
    });
  }
}

/**
 * A legacy `init*Event`: the event's type, whether it bubbles and can be cancelled, and then the
 * members `order` names, in that order. Nothing while the event is being sent.
 */
function legacyInit(name: string, members: Members, order: readonly string[]) {
  return function (this: object, ...args: unknown[]): void {
    if (args.length === 0) {
      throw new TypeError(`Failed to execute '${name}': 1 argument required, but only 0 present.`);
    }
    if (isDispatching(this)) return;
    initLegacy(this, args[0], args[1], args[2]);
    const own = fieldsOf(this);
    order.forEach((member, at) => {
      const [convert, otherwise] = members[member]!;
      const value = args[at + 3];
      own[member] = value === undefined ? otherwise : convert(value);
    });
  };
}

function defineMethod(kind: EventClass, name: string, run: (...args: never[]) => unknown): void {
  Object.defineProperty(kind.prototype, name, { value: run, writable: true, configurable: true });
}

/** Whether a modifier key was held, by its name: `Control`, `Shift`, `CapsLock`. */
function getModifierState(this: object, key: unknown): boolean {
  const member = MODIFIER_KEYS[String(key)];
  if (!member) return false;
  const own = (this as Record<string, unknown>)[member];
  return !!(own ?? fields.get(this)?.[member]);
}

/** Constants on a kind and on its events. */
function constants(kind: EventClass, values: Readonly<Record<string, number>>): void {
  for (const target of [kind, kind.prototype]) {
    for (const [name, value] of Object.entries(values)) {
      Object.defineProperty(target, name, { value, enumerable: true });
    }
  }
}

/** `UIEvent`. */
export class CompatUIEvent extends Base {
  constructor(type: string, init: Init = {}) {
    typed(arguments.length, 'UIEvent');
    super(type, init ?? {});
    take(this, init, UI);
  }
}
readOnly(CompatUIEvent, ['view', 'detail', 'which']);
defineMethod(CompatUIEvent, 'initUIEvent', legacyInit('initUIEvent', UI, ['view', 'detail']));

/** `MouseEvent`, which a touch is too: at the finger, with no key held. */
export class CompatMouseEvent extends CompatUIEvent {
  constructor(type: string, init: Init = {}) {
    typed(arguments.length, 'MouseEvent');
    super(type, init);
    take(this, init, MOUSE);
  }

  // With nothing to scroll, the page is the window.
  get pageX(): unknown {
    return (this as unknown as { clientX: unknown }).clientX;
  }

  get pageY(): unknown {
    return (this as unknown as { clientY: unknown }).clientY;
  }

  get x(): unknown {
    return (this as unknown as { clientX: unknown }).clientX;
  }

  get y(): unknown {
    return (this as unknown as { clientY: unknown }).clientY;
  }
}
readOnly(CompatMouseEvent, [...MODIFIER_MEMBERS, ...Object.keys(MOUSE).filter(notModifier)]);
defineMethod(CompatMouseEvent, 'getModifierState', getModifierState);
defineMethod(
  CompatMouseEvent,
  'initMouseEvent',
  legacyInit('initMouseEvent', { ...UI, ...MOUSE }, [
    ...['view', 'detail', 'screenX', 'screenY', 'clientX', 'clientY'],
    ...['ctrlKey', 'altKey', 'shiftKey', 'metaKey', 'button', 'relatedTarget'],
  ]),
);

function notModifier(name: string): boolean {
  return !(name in MODIFIERS);
}

/** `PointerEvent`: a touch, coming down, moving and lifting, and the click it ends in. */
export class CompatPointerEvent extends CompatMouseEvent {
  constructor(type: string, init: Init = {}) {
    typed(arguments.length, 'PointerEvent');
    super(type, init);
    take(this, init, POINTER);
  }

  getCoalescedEvents(): object[] {
    return [];
  }

  getPredictedEvents(): object[] {
    return [];
  }
}
readOnly(CompatPointerEvent, Object.keys(POINTER));

/** `WheelEvent`. */
export class CompatWheelEvent extends CompatMouseEvent {
  constructor(type: string, init: Init = {}) {
    typed(arguments.length, 'WheelEvent');
    super(type, init);
    take(this, init, WHEEL);
  }
}
readOnly(CompatWheelEvent, Object.keys(WHEEL));
constants(CompatWheelEvent, { DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 });

/** `KeyboardEvent`. */
export class CompatKeyboardEvent extends CompatUIEvent {
  constructor(type: string, init: Init = {}) {
    typed(arguments.length, 'KeyboardEvent');
    super(type, init);
    take(this, init, KEYBOARD);
  }
}
readOnly(CompatKeyboardEvent, [...MODIFIER_MEMBERS, ...Object.keys(KEYBOARD).filter(notModifier)]);
defineMethod(CompatKeyboardEvent, 'getModifierState', getModifierState);
defineMethod(
  CompatKeyboardEvent,
  'initKeyboardEvent',
  legacyInit('initKeyboardEvent', { ...UI, ...KEYBOARD }, [
    ...['view', 'key', 'location', 'ctrlKey', 'altKey', 'shiftKey', 'metaKey'],
  ]),
);
constants(CompatKeyboardEvent, {
  DOM_KEY_LOCATION_STANDARD: 0,
  DOM_KEY_LOCATION_LEFT: 1,
  DOM_KEY_LOCATION_RIGHT: 2,
  DOM_KEY_LOCATION_NUMPAD: 3,
});

/** `FocusEvent`. */
export class CompatFocusEvent extends CompatUIEvent {
  constructor(type: string, init: Init = {}) {
    typed(arguments.length, 'FocusEvent');
    super(type, init);
    take(this, init, FOCUS);
  }
}
readOnly(CompatFocusEvent, Object.keys(FOCUS));

/** `InputEvent`: what a field says as it is typed into. */
export class CompatInputEvent extends CompatUIEvent {
  constructor(type: string, init: Init = {}) {
    typed(arguments.length, 'InputEvent');
    super(type, init);
    take(this, init, INPUT);
  }

  getTargetRanges(): object[] {
    return [];
  }
}
readOnly(CompatInputEvent, Object.keys(INPUT));

/** `CompositionEvent`. */
export class CompatCompositionEvent extends CompatUIEvent {
  constructor(type: string, init: Init = {}) {
    typed(arguments.length, 'CompositionEvent');
    super(type, init);
    take(this, init, DATA);
  }
}
readOnly(CompatCompositionEvent, ['data']);
defineMethod(
  CompatCompositionEvent,
  'initCompositionEvent',
  legacyInit('initCompositionEvent', { ...UI, ...DATA }, ['view', 'data']),
);

/** `TextEvent`, which `document.createEvent` alone makes. */
export class CompatTextEvent extends CompatUIEvent {
  constructor(type: string, init: Init = {}) {
    typed(arguments.length, 'TextEvent');
    super(type, init);
    take(this, init, DATA);
  }
}
readOnly(CompatTextEvent, ['data']);
defineMethod(
  CompatTextEvent,
  'initTextEvent',
  legacyInit('initTextEvent', { ...UI, ...DATA }, ['view', 'data']),
);

/** `TouchEvent`: the fingers down, those on the target, and those that changed. */
export class CompatTouchEvent extends CompatUIEvent {
  constructor(type: string, init: Init = {}) {
    typed(arguments.length, 'TouchEvent');
    super(type, init);
    take(this, init, TOUCH_EVENT);
  }
}
readOnly(CompatTouchEvent, [...MODIFIER_MEMBERS, ...Object.keys(TOUCH_EVENT).filter(notModifier)]);
defineMethod(CompatTouchEvent, 'getModifierState', getModifierState);

const TOUCH: Members = {
  identifier: [number, 0],
  target: [object, null],
  ...Object.fromEntries(
    ['screenX', 'screenY', 'clientX', 'clientY', 'pageX', 'pageY'].map((name) => [
      name,
      [number, 0],
    ]),
  ),
  radiusX: [number, 0],
  radiusY: [number, 0],
  rotationAngle: [number, 0],
  force: [number, 0],
  altitudeAngle: [number, 0],
  azimuthAngle: [number, 0],
  touchType: [string, 'direct'],
};

/** `Touch`: one finger, by its identifier and the element it came down on. */
export class CompatTouch {
  constructor(init: Init) {
    const given = init ?? {};
    if (given['identifier'] === undefined || given['target'] === undefined) {
      throw new TypeError("Failed to construct 'Touch': identifier and target are required.");
    }
    take(this, init, TOUCH);
  }
}
readOnly(CompatTouch as unknown as EventClass, Object.keys(TOUCH));

/** `MediaQueryListEvent`: what a media query list tells its listeners when its answer changes. */
export class CompatMediaQueryListEvent extends Base {
  constructor(type: string, init: Init = {}) {
    typed(arguments.length, 'MediaQueryListEvent');
    super(type, init ?? {});
    take(this, init, { media: [String, ''], matches: [boolean, false] });
  }
}
readOnly(CompatMediaQueryListEvent, ['media', 'matches']);

/** The kinds above, by the name each has on `window`. */
export const EVENT_CLASSES: Readonly<Record<string, unknown>> = {
  UIEvent: CompatUIEvent,
  MouseEvent: CompatMouseEvent,
  PointerEvent: CompatPointerEvent,
  WheelEvent: CompatWheelEvent,
  KeyboardEvent: CompatKeyboardEvent,
  FocusEvent: CompatFocusEvent,
  InputEvent: CompatInputEvent,
  CompositionEvent: CompatCompositionEvent,
  TextEvent: CompatTextEvent,
  TouchEvent: CompatTouchEvent,
  Touch: CompatTouch,
  MediaQueryListEvent: CompatMediaQueryListEvent,
};

/** A kind, as the runtime has it where it has its own, or as it is above. */
const kindNamed = (name: string): EventClass =>
  ((globalThis as Record<string, unknown>)[name] ?? EVENT_CLASSES[name]) as EventClass;

// What `document.createEvent` makes of each name, in lower case: see `events.ts`.
for (const [name, kind] of Object.entries({
  uievent: 'UIEvent',
  uievents: 'UIEvent',
  mouseevent: 'MouseEvent',
  mouseevents: 'MouseEvent',
  keyboardevent: 'KeyboardEvent',
  focusevent: 'FocusEvent',
  touchevent: 'TouchEvent',
  compositionevent: 'CompositionEvent',
  textevent: 'TextEvent',
})) {
  eventKinds[name] = () => kindNamed(kind);
}

/** The phases, which Node's `Event` has on itself and not on its prototype. */
const PHASES = { NONE: 0, CAPTURING_PHASE: 1, AT_TARGET: 2, BUBBLING_PHASE: 3 };

/**
 * Give the runtime's `Event` the phases on its prototype, where it has them on itself alone, as
 * every event has them in a browser. Answers what takes them away again.
 */
export function phasesOnEvent(): () => void {
  const Runtime = (globalThis as { Event?: { prototype: object } }).Event;
  const prototype = Runtime?.prototype;
  const added = prototype ? Object.keys(PHASES).filter((name) => !(name in prototype)) : [];
  for (const name of added) {
    Object.defineProperty(prototype, name, {
      value: PHASES[name as keyof typeof PHASES],
      enumerable: true,
      configurable: true,
    });
  }
  return () => {
    for (const name of added) delete (prototype as Record<string, unknown>)[name];
  };
}

/** The events a touch is sent as that are pointer events: a click is one too, as Chrome has it. */
const POINTER_TYPES = new Set(['click', 'contextmenu', 'auxclick']);
const FOCUS_TYPES = new Set(['focus', 'blur', 'focusin', 'focusout']);

/** The kind a browser sends an event of each type as, from a touch, a key or a field. */
function kindOf(type: string): EventClass {
  if (type.startsWith('pointer') || POINTER_TYPES.has(type)) return kindNamed('PointerEvent');
  if (type.startsWith('mouse') || type === 'dblclick') return kindNamed('MouseEvent');
  if (type.startsWith('touch')) return kindNamed('TouchEvent');
  if (type.startsWith('key')) return kindNamed('KeyboardEvent');
  if (FOCUS_TYPES.has(type)) return kindNamed('FocusEvent');
  if (type === 'input' || type === 'beforeinput') return kindNamed('InputEvent');
  if (type === 'wheel') return kindNamed('WheelEvent');
  return ((globalThis as { Event?: EventClass }).Event ?? Base) as EventClass;
}

/** The events that do not bubble in a browser. */
const STAY = new Set([
  ...['focus', 'blur', 'scroll', 'load', 'error', 'resize'],
  ...['mouseenter', 'mouseleave', 'pointerenter', 'pointerleave'],
]);
/** The events a listener can cancel in a browser. */
const CANCELABLE = new Set([
  ...['click', 'dblclick', 'contextmenu', 'auxclick', 'wheel', 'submit', 'reset', 'beforeinput'],
  ...['mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout'],
  ...['pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout'],
  ...['touchstart', 'touchmove', 'touchend', 'keydown', 'keyup', 'keypress'],
]);

/**
 * An event this package sends for something native said, of the kind a browser would send it as,
 * with `own` as its own members: what a listener read of it when it was a plain object, read the
 * same way. Each is written to as before, as the package moves a click on up the tree.
 */
export function nativeEvent(type: string, own: Readonly<Record<string, unknown>>): object {
  const Kind = kindOf(type);
  const ui = Kind.prototype instanceof (EVENT_CLASSES['UIEvent'] as EventClass);
  const event = new Kind(type, {
    bubbles: !STAY.has(type),
    cancelable: CANCELABLE.has(type),
    composed: true,
    ...(ui ? { view: globalThis } : {}),
  });
  sentByNative(event);
  const members: PropertyDescriptorMap = {};
  for (const [name, value] of Object.entries(own)) {
    members[name] = { value, writable: true, enumerable: true, configurable: true };
  }
  return Object.defineProperties(event, members);
}

/** The click `element.click()` sends: a pointer event, as Chrome's is, from no pointer. */
export function scriptClick(): object {
  const Kind = kindNamed('PointerEvent');
  return new Kind('click', { bubbles: true, cancelable: true, composed: true, view: globalThis });
}
