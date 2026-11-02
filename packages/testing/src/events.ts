/**
 * `fireEvent` and `userEvent`, as React Native Testing Library names them, emitting the Fabric
 * events the native side would.
 *
 * Each goes through `fabric.emit`, which is the handler the renderer registered with Fabric, so an
 * event takes the real route: the engine's responder negotiation for a touch, its bubbling for the
 * rest, then the component's listener. Nothing here calls a handler directly, and a disabled
 * pressable ignores a press here for the same reason it does on a phone.
 *
 * A touch is only sent where a finger could land, as React Native Testing Library decides it from
 * `pointerEvents`: a press, a type or a clear on a node that takes no touch does nothing at all.
 *
 * Both are async where RNTL's `fireEvent` is not. Change detection is zoneless and commits on a
 * later task, so an event has to be awaited before the tree it changed can be read.
 */
import { currentOf, ownerOf, settle } from './render.ts';
import { expoUiButtonDisabled, expoUiButtonPress, isExpoUiButton } from './expo-ui-button.ts';
import { flatten, isSearchBar, isTextInput, withParents } from './queries.ts';
import type { FakeFabricNode } from './test-utils.ts';

/** A payload as a handler would see it (`{ nativeEvent }`), or the native event itself. */
export type EventPayload = Record<string, unknown>;

const nativeOf = (payload: EventPayload | undefined): Record<string, unknown> =>
  ((payload && 'nativeEvent' in payload ? payload['nativeEvent'] : payload) as Record<
    string,
    unknown
  >) ?? {};

function emit(node: FakeFabricNode, type: string, nativeEvent: Record<string, unknown> = {}): void {
  ownerOf(node).fabric.emit(node, type, { target: node.reactTag, ...nativeEvent });
}

/** `press` -> `topPress`: the naming the renderer uses for `(touchEnd)` and every other event. */
const topLevel = (name: string): string =>
  name.startsWith('top') ? name : `top${name[0]!.toUpperCase()}${name.slice(1)}`;

/** One finger, as Fabric reports it. The press machine reads `pageX`/`pageY`. */
function touch(node: FakeFabricNode, phase: 'start' | 'end'): Record<string, unknown> {
  const point = {
    identifier: 0,
    target: node.reactTag,
    pageX: 0,
    pageY: 0,
    locationX: 0,
    locationY: 0,
    timestamp: Date.now(),
  };
  return { ...point, touches: phase === 'start' ? [point] : [], changedTouches: [point] };
}

/**
 * Whether a finger could reach the node, by RNTL's reading of `pointerEvents` on the node as last
 * committed: not when it is `none` or `box-none` itself, nor under a `none` or `box-only` view.
 *
 * The walk stops at a view committed with `layoutRoot`: `@expo/ui`'s view host for content
 * presented in its own window, a sheet's or a popover's, which takes its content's touches itself,
 * so what is around it, such as the sheet's `pointerEvents: 'none'` host, has no say. So does
 * SwiftUI's sheet, for the toolbar items it presents with that content.
 */
function touchable(node: FakeFabricNode): boolean {
  withParents(ownerOf(node).fabric.committed);
  let blocking = 'box-none';
  for (let at: FakeFabricNode | null = currentOf(node) ?? node; at; at = at.parent ?? null) {
    if (at.props['layoutRoot'] === true || /ExpoUI_BottomSheetView$/.test(at.viewName)) return true;
    const pointerEvents = at.props['pointerEvents'];
    if (pointerEvents === 'none' || pointerEvents === blocking) return false;
    blocking = 'box-only';
  }
  return true;
}

/** The text field at or under a node, so a query for its wrapper still reaches the input. */
function fieldOf(node: FakeFabricNode): FakeFabricNode {
  const current = currentOf(node) ?? node;
  const field = flatten([current]).find((n) => isTextInput(n) || isSearchBar(n));
  if (!field) throw new Error(`No TextInput or search bar at or under this ${node.viewName}.`);
  return field;
}

/**
 * The count each field last sent, keyed by the node's instance handle, which its clones share, so
 * a field gone from the tree takes its count with it. Native keeps its own as a real field does,
 * since iOS is not sent it back as a prop.
 */
const sentCounts = new WeakMap<object, number>();

/** The count native would send next: one past the last one it sent, or that JS echoed back. */
function nextCount(field: FakeFabricNode): number {
  const handle = field.instanceHandle;
  const sent = typeof handle === 'object' && handle !== null ? sentCounts.get(handle) : undefined;
  const echoed = Number((currentOf(field) ?? field).props['mostRecentEventCount'] ?? 0);
  const next = Math.max(sent ?? 0, echoed) + 1;
  if (typeof handle === 'object' && handle !== null) sentCounts.set(handle, next);
  return next;
}

function changeText(field: FakeFabricNode, text: string): void {
  if (isSearchBar(field)) emit(field, 'topChangeText', { text });
  else emit(field, 'topChange', { text, eventCount: nextCount(field) });
}

/**
 * The finger lifting: the touch's end, and on `@expo/ui`'s button the press SwiftUI or Compose
 * fires for it, which a disabled one does not.
 */
function release(node: FakeFabricNode): void {
  emit(node, 'topTouchEnd', touch(node, 'end'));
  const current = currentOf(node) ?? node;
  if (isExpoUiButton(current) && !expoUiButtonDisabled(current)) emit(node, expoUiButtonPress());
}

async function press(node: FakeFabricNode): Promise<void> {
  if (!touchable(node)) return;
  emit(node, 'topTouchStart', touch(node, 'start'));
  release(node);
  await settle();
}

const named = {
  press,
  async changeText(node: FakeFabricNode, text: string): Promise<void> {
    changeText(fieldOf(node), text);
    await settle();
  },
  async scroll(node: FakeFabricNode, payload?: EventPayload): Promise<void> {
    emit(node, 'topScroll', nativeOf(payload));
    await settle();
  },
  async focus(node: FakeFabricNode): Promise<void> {
    emit(node, 'topFocus');
    await settle();
  },
  async blur(node: FakeFabricNode): Promise<void> {
    emit(node, 'topBlur');
    await settle();
  },
  /** A `(layout)` event with the frame native would report: `{ x, y, width, height }`. */
  async layout(node: FakeFabricNode, frame: Partial<LayoutFrame> = {}): Promise<void> {
    emit(node, 'topLayout', { layout: { x: 0, y: 0, width: 0, height: 0, ...frame } });
    await settle();
  },
};

/** Where a view is in its parent, and its size, as `(layout)` reports them. */
export interface LayoutFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The frame in a layout payload, written bare, as `{ layout }`, or as `{ nativeEvent: { layout } }`. */
function frameOf(payload: unknown): Partial<LayoutFrame> {
  const given = (payload ?? {}) as { nativeEvent?: unknown; layout?: Partial<LayoutFrame> };
  const event = (given.nativeEvent ?? given) as { layout?: Partial<LayoutFrame> };
  return event.layout ?? (event as Partial<LayoutFrame>);
}

type FireEvent = ((node: FakeFabricNode, name: string, payload?: unknown) => Promise<void>) &
  typeof named;

/**
 * `fireEvent(node, 'press')`, `fireEvent(node, 'changeText', 'Ada')`, or any other event by name -
 * `fireEvent(node, 'submitEditing', { text })` emits `topSubmitEditing`.
 */
export const fireEvent: FireEvent = Object.assign(
  async (node: FakeFabricNode, name: string, payload?: unknown): Promise<void> => {
    if (name === 'changeText') return named.changeText(node, String(payload));
    if (name === 'press' || name === 'scroll' || name === 'focus' || name === 'blur') {
      return named[name](node, payload as EventPayload);
    }
    // A layout by name takes the frame, or the event wrapped as `fireEvent.scroll` takes one.
    if (name === 'layout') return named.layout(node, frameOf(payload));
    emit(node, topLevel(name), nativeOf(payload as EventPayload));
    await settle();
  },
  named,
);

/** Options for `userEvent.type`, named as React Native Testing Library names them. */
export interface TypeOptions {
  /** Leave the field focused afterwards. By default typing ends with the field blurring. */
  skipBlur?: boolean;
  /** Press return at the end: `topSubmitEditing`, before any blur. */
  submitEditing?: boolean;
}

/**
 * Interactions as a person performs them: several events, a task apart, in the order the platform
 * sends them. Slower than `fireEvent`, and closer to what a device does.
 */
export interface UserEvent {
  /** A finger down and up, a task apart, through the responder. */
  press(node: FakeFabricNode): Promise<void>;
  /** A finger held for `duration` ms (500, the long-press delay, by default). */
  longPress(node: FakeFabricNode, options?: { duration?: number }): Promise<void>;
  /**
   * Focus the field, then one change per character, each with the next `eventCount`, typed into
   * the text the field shows, at its caret: after a key the app refused or rewrote, the text it put
   * back, and after `setSelection()`, where it moved the caret to.
   */
  type(node: FakeFabricNode, text: string, options?: TypeOptions): Promise<void>;
  /** Focus the field, empty it, and blur. */
  clear(node: FakeFabricNode): Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function hold(node: FakeFabricNode, duration: number): Promise<void> {
  if (!touchable(node)) return;
  emit(node, 'topTouchStart', touch(node, 'start'));
  await settle();
  if (duration) await sleep(duration);
  release(node);
  await settle();
}

/** What a field shows and where its selection sits, as `start` and `end` offsets into `text`. */
interface Shown {
  text: string;
  start: number;
  end: number;
}

/** How a command a field can be sent changes what it shows. */
const APPLY_COMMAND: Readonly<Record<string, (shown: Shown, args: readonly unknown[]) => Shown>> = {
  // `(eventCount, text, start, end)`: a `null` text leaves the text, a negative `start` the caret.
  setTextAndSelection: (shown, [, text, start, end]) => {
    const next = typeof text === 'string' ? text : shown.text;
    if (typeof start !== 'number' || start < 0) {
      if (typeof text !== 'string') return shown;
      // iOS keeps the caret its distance from the end of the old text when it sets a new one.
      const caret = Math.max(0, text.length - (shown.text.length - shown.start));
      return { text, start: caret, end: caret };
    }
    const to = typeof end === 'number' && end >= 0 ? end : start;
    return {
      text: next,
      start: Math.min(start, next.length),
      end: Math.min(Math.max(to, start), next.length),
    };
  },
  setText: (_, [text]) => ({
    text: String(text),
    start: String(text).length,
    end: String(text).length,
  }),
  clearText: () => ({ text: '', start: 0, end: 0 }),
};

/**
 * What a field shows once a keystroke is handled, which the next key is typed into: what the app
 * last put back with a command since `since`, as a field that refuses or rewrites the keystroke
 * or moves the caret does (`setTextAndSelection`, or a search bar's `setText` or `clearText`), or
 * else the text typed with the caret after it.
 */
function shownAfter(field: FakeFabricNode, typed: Shown, since: number): Shown {
  const { commands } = ownerOf(field).fabric;
  let shown = typed;
  for (let i = since; i < commands.length; i++) {
    const { node, name, args } = commands[i]!;
    if (node?.reactTag !== field.reactTag || !Object.hasOwn(APPLY_COMMAND, name)) continue;
    shown = APPLY_COMMAND[name]!(shown, args);
  }
  return shown;
}

async function endEditing(field: FakeFabricNode, text: string): Promise<void> {
  emit(field, 'topEndEditing', { text });
  emit(field, 'topBlur');
  await settle();
}

const user: UserEvent = {
  press: (node) => hold(node, 0),
  longPress: (node, { duration = 500 } = {}) => hold(node, duration),
  async type(node, text, options = {}) {
    const field = fieldOf(node);
    if (field.props['editable'] === false || !touchable(field)) return;
    emit(field, 'topFocus');
    await settle();
    const maxLength = field.props['maxLength'];
    const limit = typeof maxLength === 'number' ? maxLength : Infinity;
    const start = String((currentOf(field) ?? field).props['text'] ?? '');
    let shown: Shown = { text: start, start: start.length, end: start.length };
    for (const key of text) {
      // `maxLength` is enforced natively: the field never calls back with text past it, so a key
      // pressed once the limit is reached is swallowed the same way it would be on a device.
      if (shown.text.length - (shown.end - shown.start) + key.length > limit) continue;
      // A key goes in at the caret, replacing a selection, as a text field does.
      const typed = shown.text.slice(0, shown.start) + key + shown.text.slice(shown.end);
      const caret = shown.start + key.length;
      const since = ownerOf(field).fabric.commands.length;
      emit(field, 'topKeyPress', { key });
      changeText(field, typed);
      await settle();
      shown = shownAfter(field, { text: typed, start: caret, end: caret }, since);
    }
    const value = shown.text;
    if (options.submitEditing) emit(field, 'topSubmitEditing', { text: value });
    if (!options.skipBlur) await endEditing(field, value);
    else await settle();
  },
  async clear(node) {
    const field = fieldOf(node);
    if (field.props['editable'] === false || !touchable(field)) return;
    emit(field, 'topFocus');
    changeText(field, '');
    await settle();
    await endEditing(field, '');
  },
};

/** RNTL's `userEvent`: `userEvent.setup()` for an instance, or the same calls directly. */
export const userEvent: UserEvent & { setup(): UserEvent } = { ...user, setup: () => user };
