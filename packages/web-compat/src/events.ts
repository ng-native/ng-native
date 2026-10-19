import { domError } from './dom-error.ts';
/**
 * Listeners as `addEventListener` keeps them, and events a script sends with `dispatchEvent`.
 *
 * Every listener a node, the document, the body or the window is given is kept here, by target,
 * in the order it was added: one a library adds with `addEventListener` and one a template binds.
 * Each is also attached to the native event that stands for its type, where there is one (see
 * `listen.ts`), and that is how a touch reaches it. What a script dispatches goes through the list
 * instead, down from the window to the target and back up as the DOM has it, and never through
 * native: so a listener hears either once.
 *
 * An event is whatever object the script hands over: the runtime's own `Event` (Node's, or React
 * Native's), the one below where the runtime has none, or a plain object. Its target, phase and
 * flags are kept here and read through members set on the event itself, since neither runtime's
 * `Event` lets anything but its own `EventTarget` set them.
 *
 * A `click` that is a `MouseEvent` does what a press does once it has been heard, unless a
 * listener prevented it: see `activation.ts`.
 */

/** A listener as `addEventListener` takes one: a function, or an object with `handleEvent`. */
export type Callback = ((event: never) => unknown) | { handleEvent?: unknown };

/** What a listener is told an event with on the way it was attached natively. */
export type Heard = (event: unknown) => boolean | void;

interface Entry {
  readonly type: string;
  readonly callback: Callback;
  readonly capture: boolean;
  readonly once: boolean;
  readonly passive: boolean;
  removed: boolean;
  stop?: (() => void) | undefined;
}

/** The listeners of each target, in the order each was added. */
const registries = new WeakMap<object, Entry[]>();

const NONE = 0;
const CAPTURING_PHASE = 1;
const AT_TARGET = 2;
const BUBBLING_PHASE = 3;
/** The phases, as `Event` and every event have them. */
const PHASES = { NONE, CAPTURING_PHASE, AT_TARGET, BUBBLING_PHASE };

interface Options {
  capture: boolean;
  once: boolean;
  passive?: boolean;
  signal?: { aborted?: boolean; addEventListener?: (type: string, run: () => void) => void };
}

/** The third argument of `addEventListener`: `capture` alone, or an object of options. */
function optionsOf(options: unknown): Options {
  if (!options || typeof options !== 'object') return { capture: !!options, once: false };
  const given = options as Partial<Record<keyof Options, unknown>>;
  return {
    capture: !!given.capture,
    once: !!given.once,
    passive: given.passive === undefined ? undefined : !!given.passive,
    signal: given.signal as Options['signal'],
  };
}

const entriesOf = (target: object): Entry[] =>
  registries.get(target) ?? registries.set(target, []).get(target)!;

const findEntry = (target: object, type: string, callback: unknown, capture: boolean) =>
  registries
    .get(target)
    ?.find((each) => each.type === type && each.callback === callback && each.capture === capture);

function remove(target: object, entry: Entry): void {
  if (entry.removed) return;
  entry.removed = true;
  const entries = registries.get(target) ?? [];
  const at = entries.indexOf(entry);
  if (at !== -1) entries.splice(at, 1);
  entry.stop?.();
}

/**
 * Add a listener to a target, as `addEventListener` does: once for a type, a callback and a
 * phase, however often it is asked. `attach` attaches it to what native says for the type, and
 * answers what takes it off again. Answers what removes the listener, where one was added.
 */
export function listen(
  target: object,
  type: string,
  callback: unknown,
  options: unknown,
  attach?: (heard: Heard) => (() => void) | undefined,
): (() => void) | undefined {
  const { capture, once, passive, signal } = optionsOf(options);
  if (!callback || (typeof callback !== 'function' && typeof callback !== 'object')) return;
  if (signal?.aborted || findEntry(target, type, callback, capture)) return undefined;
  const entry: Entry = {
    type,
    callback: callback as Callback,
    capture,
    once,
    passive: passive ?? (PASSIVE_TYPES.has(type) && passiveByDefault.has(target)),
    removed: false,
  };
  entriesOf(target).push(entry);
  const removeEntry = () => remove(target, entry);
  signal?.addEventListener?.('abort', removeEntry);
  entry.stop = attach?.((event) => {
    // One taken off is told nothing that comes later: the mouse after a touch is told so.
    if (entry.removed) return;
    if (once) removeEntry();
    return call(entry, target, event) as boolean | void;
  });
  return removeEntry;
}

/** What a listener on the window, the document, its root or its body is passive to unless told. */
const PASSIVE_TYPES = new Set(['touchstart', 'touchmove', 'wheel', 'mousewheel']);
const passiveByDefault = new WeakSet<object>([globalThis]);

/**
 * Have a listener on these be passive unless it is told not to be, for a touch or a wheel, as
 * one on the window is: the document, its root and its body.
 */
export function passiveFor(...targets: object[]): void {
  for (const target of targets) passiveByDefault.add(target);
}

/** Remove every listener a target has: the window's, as the package leaves it. */
export function unlistenAll(target: object): void {
  for (const entry of [...(registries.get(target) ?? [])]) remove(target, entry);
}

/** Remove a listener, as `removeEventListener` does: by its type, callback and phase. */
export function unlisten(target: object, type: string, callback: unknown, options: unknown): void {
  const entry = findEntry(target, type, callback, optionsOf(options).capture);
  if (entry) remove(target, entry);
}

/** Call a listener: a function as the target's own, an object by its `handleEvent`. */
function call(entry: Entry, target: object, event: unknown): unknown {
  const { callback } = entry;
  if (typeof callback === 'function') return (callback as Heard).call(target, event);
  const handle = callback.handleEvent;
  if (typeof handle !== 'function') throw new TypeError('The listener has no handleEvent.');
  return (handle as Heard).call(callback, event);
}

/** Where an event is, as it is sent, and what its listeners have said of it. */
interface State {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  composed: boolean;
  detail: unknown;
  target: object | null;
  current: object | null;
  phase: number;
  path: readonly object[];
  stop: boolean;
  stopNow: boolean;
  canceled: boolean;
  passive: boolean;
  dispatching: boolean;
  initialized: boolean;
}

const states = new WeakMap<object, State>();

export interface EventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
  detail?: unknown;
}

type Event = Record<string, unknown>;

/** The arguments of `initEvent`, of which the type is not optional. */
function required(args: unknown[], name: string): [unknown, unknown, unknown] {
  if (!args.length) throw new TypeError(`Failed to execute '${name}': 1 argument required.`);
  return [args[0], args[1], args[2]];
}

/** Set an event up as `initEvent` does, where it is not being sent. */
function initEvent(state: State, type: unknown, bubbles?: unknown, cancelable?: unknown): void {
  if (state.dispatching) return;
  Object.assign(state, {
    type: String(type),
    bubbles: !!bubbles,
    cancelable: !!cancelable,
    initialized: true,
    stop: false,
    stopNow: false,
    canceled: false,
    target: null,
  });
}

function preventDefault(state: State): void {
  if (state.cancelable && !state.passive) state.canceled = true;
}

/** What each member an event is read through reads of its state. */
const READ: Readonly<Record<string, keyof State>> = {
  type: 'type',
  bubbles: 'bubbles',
  cancelable: 'cancelable',
  composed: 'composed',
  target: 'target',
  srcElement: 'target',
  currentTarget: 'current',
  eventPhase: 'phase',
  defaultPrevented: 'canceled',
};

/**
 * The members an event is read and stopped through, over its state. Those of an `Event` are
 * read-only, as a browser has them; those of a plain object a script made are written to as
 * well, as they were before it was sent: this package hands its own listeners such objects, and
 * moves one on up the tree by setting its `currentTarget`.
 */
function membersOf(state: State, plain: boolean): PropertyDescriptorMap {
  const fields = state as unknown as Record<string, unknown>;
  const read = (get: () => unknown, set?: (value: unknown) => void) => ({
    get,
    set,
    configurable: true,
  });
  const value = (run: (...args: never[]) => unknown) => ({
    value: run,
    writable: true,
    configurable: true,
  });
  const members: PropertyDescriptorMap = {};
  for (const [name, key] of Object.entries(READ)) {
    members[name] = read(() => fields[key], plain ? (to) => void (fields[key] = to) : undefined);
  }
  return {
    ...members,
    returnValue: read(
      () => !state.canceled,
      (to) => void (to ? undefined : preventDefault(state)),
    ),
    cancelBubble: read(
      () => state.stop,
      (to) => void (state.stop ||= !!to),
    ),
    composedPath: value(() => (state.dispatching ? [...state.path] : [])),
    stopPropagation: value(() => void (state.stop = true)),
    stopImmediatePropagation: value(() => void (state.stop = state.stopNow = true)),
    preventDefault: value(() => preventDefault(state)),
    initEvent: value((...args: never[]) => initEvent(state, ...required(args, 'initEvent'))),
  };
}

/** Whether an event is an `Event`, the runtime's or this package's, and not a plain object. */
function isEvent(event: object): boolean {
  const Runtime = (globalThis as { Event?: unknown }).Event;
  return (
    event instanceof CompatEvent || (typeof Runtime === 'function' && event instanceof Runtime)
  );
}

/**
 * The state of an event, kept from the first time it is sent or made here. What the event says
 * of itself then is where it starts: its type, and whether it was already stopped or prevented.
 */
function stateOf(event: Event, init?: EventInit & { type: string }, initialized = true): State {
  const had = states.get(event);
  if (had) return had;
  const given = init ?? event;
  const state: State = {
    type: String(given['type']),
    bubbles: !!given['bubbles'],
    cancelable: !!given['cancelable'],
    composed: !!given['composed'],
    detail: init ? (init.detail ?? null) : undefined,
    target: null,
    current: null,
    phase: NONE,
    path: [],
    stop: event['cancelBubble'] === true,
    stopNow: false,
    canceled: event['defaultPrevented'] === true,
    passive: false,
    dispatching: false,
    initialized,
  };
  states.set(event, state);
  addMembers(event, state);
  return state;
}

/** Give an event the members it is read and stopped through, where its own are not enough. */
function addMembers(event: Event, state: State): void {
  // One this package sent for a press is written to as a plain object was: see `nativeEvent`.
  const real = isEvent(event) && !fromNative.has(event);
  Object.defineProperties(event, membersOf(state, !real));
  // A custom event's `initCustomEvent`, which neither Node's nor React Native's has. Not a UI
  // event's, whose `detail` is its own.
  if (real && 'detail' in event && typeof event['initCustomEvent'] !== 'function' && !isUi(event)) {
    state.detail = event['detail'];
    Object.defineProperties(event, customMembers(state));
  }
  // The phases, which every event has and Node's has only on `Event` itself.
  for (const [name, phase] of Object.entries(PHASES)) {
    if (!(name in event)) Object.defineProperty(event, name, { value: phase });
  }
}

const isUi = (event: Event): boolean => typeof event['initUIEvent'] === 'function';

/** The events this package made for what native said, which it writes to as it sends them. */
const fromNative = new WeakSet<object>();

/**
 * An event made for what native said, which is sent from here as a plain object was: its state
 * is made afresh if a script sends it on, and its members are written to.
 */
export function sentByNative(event: object): void {
  states.delete(event);
  fromNative.add(event);
}

/** Whether an event is being sent now, in which a legacy `init*Event` does nothing. */
export const isDispatching = (event: object): boolean => states.get(event)?.dispatching === true;

/** What a legacy `init*Event` sets of every event: see `initEvent`. */
export function initLegacy(event: object, type: unknown, bubbles: unknown, cancelable: unknown) {
  initEvent(stateOf(event as Event), type, bubbles, cancelable);
}

/**
 * What a `click` does once it has been heard, set by what knows the elements: for the click and
 * the path it is sent along, what to run once it is over, told whether it was cancelled. Run
 * before any listener hears it, as a checkbox is checked before its listeners are told.
 */
export const activation: {
  of?: (event: object, type: string, path: readonly object[]) => ((done: boolean) => void) | void;
} = {};

/** Report what a listener threw, as a browser does, and go on to the next. */
export function report(error: unknown): void {
  const window = globalThis as {
    reportError?: (error: unknown) => void;
    onerror?: (...args: unknown[]) => unknown;
  };
  if (typeof window.reportError === 'function') return window.reportError(error);
  // Where the runtime cannot: as an `error` event on the window, and to `onerror`, and to the
  // console where neither said it was dealt with. Not again for what those throw.
  let handled = reporting;
  if (!reporting) {
    reporting = true;
    try {
      const message = error instanceof Error ? error.message : String(error);
      const event = Object.assign(newEvent('error', { cancelable: true }), { message, error });
      handled = !dispatch(event, [globalThis]);
      handled = window.onerror?.(message, '', 0, 0, error) === true || handled;
    } finally {
      reporting = false;
    }
  }
  if (!handled) console.error(error);
}

/** Whether an error is being reported now, which an error in reporting it is not. */
let reporting = false;

/** The event a listener is being told now, which is `window.event`. */
let current: unknown;

/**
 * `window.event`: the event a listener is being told, while it is told it. One a script sets is
 * kept in its place, and no event is put there again, as a browser has it.
 */
export const windowEvent: PropertyDescriptor = {
  get: () => current,
  set: (value: unknown) =>
    Object.defineProperty(globalThis, 'event', {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    }),
  configurable: true,
  enumerable: true,
};

/** Tell the listeners of one target on the path, for one of its phases. */
function invoke(event: Event, state: State, target: object, phase: number, capture: boolean): void {
  if (state.stop) return;
  state.current = target;
  state.phase = phase;
  // A copy: one added as these run is not told, and one removed is not told either.
  for (const entry of [...(registries.get(target) ?? [])]) {
    if (entry.removed || entry.type !== state.type || entry.capture !== capture) continue;
    if (entry.once) remove(target, entry);
    state.passive = entry.passive;
    const outer = current;
    current = event;
    try {
      call(entry, target, event);
    } catch (error) {
      report(error);
    } finally {
      current = outer;
    }
    state.passive = false;
    if (state.stopNow) return;
  }
}

/** Tell the listeners along a path: down through each in capture, and back up where it bubbles. */
function sendAlong(event: Event, state: State, path: readonly object[]): void {
  for (let at = path.length - 1; at >= 0; at--) {
    invoke(event, state, path[at]!, at === 0 ? AT_TARGET : CAPTURING_PHASE, true);
  }
  for (let at = 0; at < path.length; at++) {
    if (at > 0 && !state.bubbles) break;
    invoke(event, state, path[at]!, at === 0 ? AT_TARGET : BUBBLING_PHASE, false);
  }
}

/**
 * Send an event along a path, its target first and the window last: down through each in
 * capture, and back up where it bubbles. Answers whether no listener prevented its default.
 */
export function dispatch(event: unknown, path: readonly object[]): boolean {
  if (!event || typeof event !== 'object') {
    throw new TypeError("Failed to execute 'dispatchEvent': parameter 1 is not of type 'Event'.");
  }
  const state = stateOf(event as Event);
  if (state.dispatching || !state.initialized) {
    throw domError(
      'The event is already being dispatched, or was not initialized.',
      'InvalidStateError',
    );
  }
  Object.assign(state, { dispatching: true, target: path[0] ?? null, path });
  const activated = activation.of?.(event, state.type, path);
  try {
    sendAlong(event as Event, state, path);
  } finally {
    Object.assign(state, {
      dispatching: false,
      current: null,
      phase: NONE,
      path: [],
      stop: false,
      stopNow: false,
    });
  }
  activated?.(!state.canceled);
  return !state.canceled;
}

/** `Event`, for a runtime that has none. */
export class CompatEvent {
  // A field and not a declared one: the app's bundler takes no `declare` in a class.
  readonly timeStamp = Date.now();

  constructor(type: string, init?: EventInit) {
    if (arguments.length === 0) {
      throw new TypeError("Failed to construct 'Event': 1 argument required, but only 0 present.");
    }
    stateOf(this as unknown as Event, { ...init, type: String(type) });
  }

  get isTrusted(): boolean {
    return false;
  }
}

/** `CustomEvent`, for a runtime that has none. */
export class CompatCustomEvent extends CompatEvent {
  constructor(type: string, init?: EventInit) {
    super(type, init);
    const state = stateOf(this as unknown as Event);
    state.detail = init?.detail ?? null;
    Object.defineProperties(this, customMembers(state));
  }
}

for (const target of [CompatEvent, CompatEvent.prototype]) {
  for (const [name, phase] of Object.entries(PHASES)) {
    Object.defineProperty(target, name, { value: phase, enumerable: true });
  }
}

/** The kinds `document.createEvent` makes, by the name it is given in lower case. */
const KINDS = new Set([
  'event',
  'events',
  'htmlevents',
  'svgevents',
  'customevent',
  'uievent',
  'uievents',
  'mouseevent',
  'mouseevents',
  'keyboardevent',
  'focusevent',
  'touchevent',
  'dragevent',
  'compositionevent',
  'textevent',
  'messageevent',
  'storageevent',
  'hashchangeevent',
  'beforeunloadevent',
  'devicemotionevent',
  'deviceorientationevent',
]);

/** The kinds `createEvent` makes of their own, by name: see `event-classes.ts`. */
export const eventKinds: Record<string, () => new (type: string) => object> = {};

/**
 * `document.createEvent`: an event of the runtime's `Event`, with no type until `initEvent`
 * gives it one, and refused by `dispatchEvent` until then. A custom event takes its detail from
 * `initCustomEvent`, and a UI, mouse, key or touch event its members from its own `init*Event`.
 * Any other kind is an event, as one with no members of its own.
 */
export function createEvent(kind: unknown): object {
  const name = String(kind).toLowerCase();
  if (!KINDS.has(name))
    throw domError(`The event kind '${String(kind)}' is not supported.`, 'NotSupportedError');
  const Made =
    eventKinds[name]?.() ??
    (globalThis as { Event?: new (type: string) => object }).Event ??
    CompatEvent;
  const event = new Made('') as Event;
  // Made afresh, as not yet given its type: this package's `Event` makes its state as it is made.
  states.delete(event);
  const state = stateOf(event, { type: '' }, false);
  return name === 'customevent' ? Object.defineProperties(event, customMembers(state)) : event;
}

/** A custom event's `detail` over its state, and `initCustomEvent` to set it with the rest. */
function customMembers(state: State): PropertyDescriptorMap {
  return {
    detail: { get: () => state.detail, configurable: true },
    initCustomEvent: {
      value: (...args: unknown[]) => {
        if (state.dispatching) return;
        initEvent(state, ...required(args, 'initCustomEvent'));
        state.detail = args[3] ?? null;
      },
      writable: true,
      configurable: true,
    },
  };
}

/** An event of the runtime's own `Event`, or this package's: one the package itself sends. */
export function newEvent(type: string, init?: EventInit): object {
  const Made = (globalThis as { Event?: new (type: string, init?: EventInit) => object }).Event;
  return Made ? new Made(type, init) : new CompatEvent(type, init);
}
