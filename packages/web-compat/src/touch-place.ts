import { nativePlatform, type Engine, type EngineNode } from '@ng-native/fabric';
import { windowTop } from './window-size.ts';

/**
 * Where native measures a view in a screen under a navigation header, against where it is drawn
 * and touched. On Android `react-native-screens` measures every view in the screen from under its
 * header, and a touch is placed from the top of the screen, which is where the view is drawn
 * from: so a view is measured the header's height short of where it is, and a library that
 * compares a finger with what it measured, a drag sorting its list by the finger's place among
 * the items, finds the finger on the item below. A view in the body is measured where it is. On
 * iOS a view is measured where it is drawn.
 *
 * A touch says where it is in the view it lands on, so the first of each finds out whether native
 * measures that view short, before a listener is told of it and measures: until one does, a view
 * in a screen on Android is taken to be measured short.
 *
 * ponytail: one answer for every screen of an app, from the last touch on a view in one. Keep
 * one a screen if a screen with a header drawn over its content is seen measured where it is.
 */

/** What touches have said of each app: whether a view in a screen is measured short. */
const short = new WeakMap<Engine, boolean>();
/** The apps with a finger down, whose touch has been asked already. */
const down = new WeakSet<Engine>();
/** The apps whose fingers are heard lifting. */
const heard = new WeakSet<Engine>();

interface Touch {
  readonly pageY?: number;
  readonly locationY?: number;
}

/** A touch as native says it: where it is on the screen, and in the view it is on. */
interface Landed {
  readonly nativeEvent?: Touch & {
    readonly touches?: readonly Touch[];
    readonly changedTouches?: readonly Touch[];
  };
  readonly target?: EngineNode | null;
}

/** Whether a node is in a screen of a stack, which is what is under a navigation header. */
function inScreen(node: EngineNode): boolean {
  for (let up: EngineNode | null = node; up; up = up.parent) if (up.tag === 'screen') return true;
  return false;
}

/**
 * Note what a touch says of where its view is measured: from the first event of each, as it
 * starts, before a listener is told of it. Nothing off Android, or for a touch that does not say
 * where it is in its view, or one whose view is further out than the header (a view moved by a
 * transform, say).
 */
export function noteTouch(engine: Engine, event: unknown): void {
  const { nativeEvent, target } = (event ?? {}) as Landed;
  if (!startsATouch(engine, nativeEvent)) return;
  const header = windowTop(engine);
  if (!target || !header || !inScreen(target)) return;
  const by = drawnBelow(engine, target, nativeEvent.changedTouches?.[0] ?? nativeEvent);
  if (by === undefined) return;
  // Within a point either way: the rounding of either.
  if (Math.abs(by - header) < 1) short.set(engine, true);
  else if (Math.abs(by) < 1) short.set(engine, false);
}

/** Whether an event is the first of a touch on Android, which is noted as down until it lifts. */
function startsATouch(
  engine: Engine,
  said: Landed['nativeEvent'],
): said is NonNullable<typeof said> {
  if (nativePlatform() !== 'android' || down.has(engine) || !said?.touches?.length) return false;
  down.add(engine);
  hearLifts(engine);
  return true;
}

/** How far further down the screen a touch says its view starts than native measures it. */
function drawnBelow(engine: Engine, target: EngineNode, touch: Touch): number | undefined {
  if (touch.pageY === undefined || touch.locationY === undefined) return undefined;
  let measured: number | undefined;
  engine.measure(target, (frame) => (measured = frame.y));
  return measured === undefined ? undefined : touch.pageY - touch.locationY - measured;
}

/** Hear an app's last finger lift, after which its next touch is asked again. */
function hearLifts(engine: Engine): void {
  if (heard.has(engine)) return;
  heard.add(engine);
  for (const end of ['topTouchEnd', 'topTouchCancel']) {
    engine.setEventListener(engine.root, end, (event) => {
      if (!(event as Landed).nativeEvent?.touches?.length) down.delete(engine);
    });
  }
}

/** How much further down the screen a node is drawn than native measures it to be. */
export function furtherDown(engine: Engine, node: EngineNode): number {
  if (nativePlatform() !== 'android' || short.get(engine) === false) return 0;
  return inScreen(node) ? windowTop(engine) : 0;
}
