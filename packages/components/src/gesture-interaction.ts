/**
 * A native gesture that ended, as the parts of an `InteractionEvent` the gesture decides.
 *
 * A tap is a `click` and a long press a `long-press`, as on a `<pressable>`. A fling is a `swipe`,
 * and so is a pan released at a flick's speed; a slower pan, a pinch, a rotation and anything else
 * is a `gesture`. `gesture` always names the kind, so an observer can tell a tap gesture from a
 * pressed control.
 */
import type { EndedGesture, GestureEndValues } from './gesture-backend.ts';
import {
  SWIPE_VELOCITY,
  type InteractionDirection,
  type InteractionEvent,
} from './interaction-observer.ts';

/** The library's `Directions` bits. */
const DIRECTIONS: Record<number, InteractionDirection> = {
  1: 'right',
  2: 'left',
  4: 'up',
  8: 'down',
};

/** A fling's default, as the library documents it. */
const FLING_DEFAULT = 1;

/**
 * Gestures that are not an interaction of their own: a pointer passing over a view, and a native
 * view's own touch handling, which that view (a scroll view, a control) reports itself.
 */
const UNREPORTED = new Set(['hover', 'native-view']);

export type GestureInteraction = Pick<
  InteractionEvent,
  | 'type'
  | 'gesture'
  | 'direction'
  | 'distance'
  | 'scale'
  | 'pageX'
  | 'pageY'
  | 'locationX'
  | 'locationY'
>;

/** `LongPressGestureHandler` as `long-press`. */
function gestureKind(handlerName: string): string {
  return handlerName
    .replace(/GestureHandler$/, '')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/** Which way the finger moved, by the axis it moved further along, or undefined if it did not. */
function fingerDirection(dx: number, dy: number): InteractionDirection | undefined {
  if (dx === 0 && dy === 0) return undefined;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** How far the finger moved from where it came down, or undefined without both points. */
function fingerMoved(end: GestureEndValues): { dx: number; dy: number } | undefined {
  const { absoluteX, absoluteY, startX, startY } = end;
  if (absoluteX === undefined || absoluteY === undefined) return undefined;
  if (startX === undefined || startY === undefined) return undefined;
  return { dx: absoluteX - startX, dy: absoluteY - startY };
}

/**
 * A fling's direction: the one it was set to recognise, or with several, the way the finger
 * moved from where it came down, since its end event carries no translation.
 */
function flingDirection(
  ended: EndedGesture,
  moved: { dx: number; dy: number } | undefined,
): InteractionDirection | undefined {
  const only = DIRECTIONS[ended.directions ?? FLING_DEFAULT];
  if (only) return only;
  return moved && fingerDirection(moved.dx, moved.dy);
}

type Detail = Omit<GestureInteraction, 'gesture'>;

/** Where a tap or long press landed, as a press reports it. */
function pressed(type: 'click' | 'long-press', end: GestureEndValues): Detail {
  return {
    type,
    ...(end.absoluteX !== undefined && { pageX: end.absoluteX }),
    ...(end.absoluteY !== undefined && { pageY: end.absoluteY }),
    ...(end.x !== undefined && { locationX: end.x }),
    ...(end.y !== undefined && { locationY: end.y }),
  };
}

function panned(end: GestureEndValues): Detail {
  const dx = end.translationX ?? 0;
  const dy = end.translationY ?? 0;
  // The library's velocities are points per second, and `SWIPE_VELOCITY` is points per
  // millisecond: the threshold a scroll view's drag is held to, so a flick through a carousel
  // built on a pan and a flick through a list are told apart the same way.
  const speed = Math.hypot(end.velocityX ?? 0, end.velocityY ?? 0) / 1000;
  const direction = fingerDirection(dx, dy);
  return {
    type: direction && speed >= SWIPE_VELOCITY ? 'swipe' : 'gesture',
    ...(direction && { direction }),
    distance: Math.round(Math.hypot(dx, dy)),
  };
}

const DETAIL: Record<string, (ended: EndedGesture) => Detail> = {
  tap: ({ end }) => pressed('click', end),
  'long-press': ({ end }) => pressed('long-press', end),
  pan: ({ end }) => panned(end),
  fling: (ended) => {
    const moved = fingerMoved(ended.end);
    const direction = flingDirection(ended, moved);
    return {
      type: 'swipe',
      ...(direction && { direction }),
      ...(moved && { distance: Math.round(Math.hypot(moved.dx, moved.dy)) }),
    };
  },
  pinch: ({ end }) => ({ type: 'gesture', ...(end.scale !== undefined && { scale: end.scale }) }),
};

/** The event's parts for a gesture that ended, or null for one that is not reported. */
export function gestureInteraction(ended: EndedGesture): GestureInteraction | null {
  const gesture = gestureKind(ended.handlerName);
  if (UNREPORTED.has(gesture)) return null;
  const { type, ...detail } = DETAIL[gesture]?.(ended) ?? { type: 'gesture' };
  return { type, gesture, ...detail };
}
