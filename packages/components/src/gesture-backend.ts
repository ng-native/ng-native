/**
 * Platform capability: native gesture recognition, from react-native-gesture-handler.
 *
 * A gesture is recognised by the platform - a `UIPanGestureRecognizer`, an Android
 * `GestureDetector` - rather than by our own responder negotiation. That is what makes a drag
 * inside a scroll view behave, and what a pinch or a rotation needs to exist at all.
 *
 * Injected rather than imported for the reason everything in this shape is: the library reaches
 * React Native's Flow source, which Node cannot parse. `NativeGesture` in `../gestures.ts` carries
 * the real backend as its own provider, so importing the directive is the whole setup.
 */
import { InjectionToken } from '@angular/core';

/**
 * A gesture built by the library's own `Gesture` API: `Gesture.Pan()`, or a composition of
 * several. Opaque here on purpose - the shape is the library's, and this package does not know it.
 */
export type GestureSpec = object;

/** What a gesture is attached to: a node's react tag. */
export interface GestureTarget {
  readonly tag: number;
}

/**
 * A gesture that has just ended successfully, as the backend hands it over on the JavaScript
 * thread: what the library calls it, and the few numbers of its end event a report is built from.
 */
export interface EndedGesture {
  /** The library's `handlerName`: `PanGestureHandler`, `TapGestureHandler`, ... */
  readonly handlerName: string;
  /** A fling's `direction` setting, the library's `Directions` bits, or undefined for its default. */
  readonly directions?: number;
  readonly end: GestureEndValues;
}

/** The numbers copied off a gesture's end event, and where its touch began in the window. */
export interface GestureEndValues {
  readonly handlerTag: number;
  readonly x?: number;
  readonly y?: number;
  readonly absoluteX?: number;
  readonly absoluteY?: number;
  readonly translationX?: number;
  readonly translationY?: number;
  readonly velocityX?: number;
  readonly velocityY?: number;
  readonly scale?: number;
  readonly startX?: number;
  readonly startY?: number;
}

export interface GestureBackend {
  /**
   * Attach `gesture` to `target`, and return the function that detaches it. `report`, when given,
   * hears each of its gestures that ends successfully, on the JavaScript thread; without it the
   * backend does no reporting work at all.
   */
  attach(
    target: GestureTarget,
    gesture: GestureSpec,
    report?: (ended: EndedGesture) => void,
  ): () => void;
}

export const GESTURES = new InjectionToken<GestureBackend>('angular-native.gestures');
