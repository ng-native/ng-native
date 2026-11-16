/**
 * `untrackedGesture(gesture)`: the per-gesture form of `[trackGesture]="false"`, for one gesture
 * of a composed one.
 *
 * ```ts
 * Gesture.Race(Gesture.Tap(), untrackedGesture(Gesture.Pan()));
 * ```
 *
 * The gesture is recorded here rather than on the gesture object, so the library's classes stay
 * as they are, and the backend reads the record when the gesture is attached.
 */

/** The gestures `untrackedGesture` was given, and the gestures inside a composed one among them. */
const UNTRACKED = new WeakSet<object>();

/** What the library's gestures, single and composed, have: the single gestures they attach. */
interface Composable {
  toGestureArray?(): readonly object[];
}

/**
 * Keep `gesture` out of interaction reports, and return it. A composed gesture keeps every
 * gesture it is made of out.
 */
export function untrackedGesture<T extends object>(gesture: T): T {
  UNTRACKED.add(gesture);
  for (const part of (gesture as Composable).toGestureArray?.() ?? []) UNTRACKED.add(part);
  return gesture;
}

/** The gestures of `gestures` that interaction observers hear: all but the untracked ones. */
export function trackedGestures<T extends object>(gestures: readonly T[]): T[] {
  return gestures.filter((gesture) => !UNTRACKED.has(gesture));
}
