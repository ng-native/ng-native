/**
 * react-native-gesture-handler, without React: a native gesture attached to one of our nodes.
 *
 * ```ts
 * import { Gesture } from 'react-native-gesture-handler';
 * import { NativeGesture } from '@ng-native/components/gestures';
 *
 * protected readonly pan = Gesture.Pan().onUpdate((event) => {
 *   'worklet';
 *   x.value = event.translationX;
 * });
 * ```
 * ```html
 * <gesture-root>
 *   <view [gesture]="pan" [workletStyle]="slide"></view>
 * </gesture-root>
 * ```
 *
 * `GestureDetector` is a React component whose job is to hold a ref, turn it into a view tag, and
 * hand that tag to the native module. Everything under it is a plain function of that tag:
 * `attachHandlers` and `dropHandlers` import no React at runtime, so they are used here as they
 * are, and the gesture objects themselves - `Gesture.Pan()`, the compositions, the config - are
 * the library's own public API and come across untouched.
 *
 * What is written out is the part `useAnimatedGesture` does with hooks: a worklet that turns the
 * raw stream of events into the callbacks a gesture declares. Reanimated's `registerEventHandler`
 * is the same call their `WorkletEventHandler` makes, once per event name per view tag.
 *
 * A gesture whose callbacks are not worklets needs none of that: the library attaches it as a
 * JavaScript-function gesture and its own event receiver, started when the package is first
 * imported, calls them on the JavaScript thread.
 *
 * **A gesture callback must not read `this`, on either thread.** The Babel plugin rewrites one
 * into a worklet whether or not it will run on the UI thread, and a rewritten callback has no
 * `this`; `runOnJS(true)` decides where it runs, not what it may close over. Read what it needs
 * through a local, as a worklet style does.
 *
 * **The internals are reached through `src/`, and that is load-bearing.** Both libraries point
 * their `react-native` package field at their TypeScript source, and Metro prefers that field, so
 * `react-native-gesture-handler` in an app resolves to `src/index.ts`. Importing the built `lib/`
 * copy of a file instead gives a second, parallel copy of the library with its own module state:
 * handlers registered in one copy's registry, the event receiver listening in the other's, and
 * every JavaScript gesture silently doing nothing.
 *
 * Deliberately outside the barrel: everything here reaches React Native's Flow source, which Node
 * cannot parse, and the rest of the package has to stay loadable in the test suite.
 */
import { Component, Directive, ElementRef, inject } from '@angular/core';
import { claimHost, nativePlatform, registerViewName, type HostNode } from '@ng-native/fabric';
import {
  gestureDispatcher,
  type GestureCallbacks,
  type GestureStateManager,
} from './gesture-dispatch.ts';
import { GESTURES, type GestureBackend } from './gesture-backend.ts';
import { NativeGestureBase } from './native-gesture.ts';

// For the side effect: evaluating the package's index is what starts its event receiver, which
// is what delivers a gesture whose callbacks are ordinary functions. An app importing `Gesture`
// does this too; this file does not depend on that. A `require`, so the published types do not
// name a library a web app may not have installed.
require('react-native-gesture-handler');

export { type GestureSpec, type GestureTarget } from './gesture-backend.ts';

/**
 * The internals, required rather than imported, and each with a literal path because Metro builds
 * its graph from those.
 *
 * Not for laziness: a static import would put these TypeScript sources into our own type-checking
 * program, where they fail against settings of ours they were never written for
 * (`verbatimModuleSyntax`, `erasableSyntaxOnly`). `require` asks Metro for the module and leaves
 * the compiler out of it, which is the same trade `@ng-native/device` makes for React Native.
 */
const { attachHandlers } =
  require('react-native-gesture-handler/src/handlers/gestures/GestureDetector/attachHandlers.ts') as {
    attachHandlers(config: {
      preparedGesture: object;
      gestureConfig: object;
      gesturesToAttach: readonly object[];
      viewTag: number;
      webEventHandlersRef: object;
    }): void;
  };

const { dropHandlers } =
  require('react-native-gesture-handler/src/handlers/gestures/GestureDetector/dropHandlers.ts') as {
    dropHandlers(prepared: object): void;
  };

const { maybeInitializeFabric } = require('react-native-gesture-handler/src/init.ts') as {
  maybeInitializeFabric(): void;
};

const { GestureStateManager } =
  require('react-native-gesture-handler/src/handlers/gestures/gestureStateManager.ts') as {
    GestureStateManager: { create(handlerTag: number): GestureStateManager };
  };

/**
 * The same call Reanimated's own `WorkletEventHandler` makes: one registration per event name per
 * view tag, which is all a gesture needs to reach the UI runtime. Not public either.
 */
const { registerEventHandler, unregisterEventHandler } =
  require('react-native-reanimated/src/core.ts') as {
    registerEventHandler(
      worklet: (event: never) => void,
      eventName: string,
      emitterReactTag: number,
    ): number;
    unregisterEventHandler(id: number): void;
  };

/** The gesture object, as far as this file needs to know it. */
interface Attachable {
  initialize(): void;
  prepare(): void;
  toGestureArray(): { handlers: GestureCallbacks; shouldUseReanimated: boolean }[];
}

const EVENT_NAMES = ['onGestureHandlerStateChange', 'onGestureHandlerEvent'];

/**
 * A gesture's own state controller, for the touch callbacks: a worklet that accepts or rejects
 * the gesture while it is still being recognised. Wrapped in a worklet of ours because everything
 * the dispatcher closes over is serialised onto the UI runtime with it.
 */
const createManager = (handlerTag: number): GestureStateManager => {
  'worklet';
  return GestureStateManager.create(handlerTag);
};

const backend: GestureBackend = {
  attach: (target, gesture) => {
    maybeInitializeFabric();
    const config = gesture as Attachable;
    const gesturesToAttach = config.toGestureArray();
    // The library's own state object. Only `isMounted` is read back by anything of ours - the
    // microtasks `attachHandlers` queues check it, so a directive torn down in the same tick as
    // it was created does not attach a handler nobody will drop.
    const prepared = {
      attachedGestures: [],
      animatedEventHandler: null,
      animatedHandlers: null,
      shouldUseReanimated: gesturesToAttach.some((g) => g.shouldUseReanimated),
      isMounted: true,
    };
    attachHandlers({
      preparedGesture: prepared,
      gestureConfig: config,
      gesturesToAttach,
      viewTag: target.tag,
      // Web only, and there is no web here. The library reads `.current` off it on that platform.
      webEventHandlersRef: { current: {} },
    });

    // One dispatcher for both event names, as the library's own event handler is: a gesture's
    // state changes and its updates arrive on different names and share the same state.
    const animated = gesturesToAttach.filter((g) => g.shouldUseReanimated);
    const dispatch = gestureDispatcher(
      animated.map((g) => g.handlers),
      createManager,
    );
    const registrations = animated.length
      ? EVENT_NAMES.map((name) => registerEventHandler(dispatch, name, target.tag))
      : [];

    return () => {
      prepared.isMounted = false;
      for (const id of registrations) unregisterEventHandler(id);
      dropHandlers(prepared);
    };
  },
};

@Directive({
  selector: '[gesture]',
  providers: [{ provide: GESTURES, useValue: backend }],
})
export class NativeGesture extends NativeGestureBase {}

/**
 * The root the gestures are recognised inside. Wrap the app in one, as the library's own
 * `GestureHandlerRootView` is wrapped.
 *
 * **It is a different view on each platform, and that is the library's own split.**
 * `RNGestureHandlerRootView` is an Android view group that intercepts touches before the rest of
 * the tree sees them; on iOS the recognisers hang off the target view itself, the component
 * provider returns nil, and their own root view renders a plain `View`. Registering the native
 * name on both would render an unimplemented component on iOS.
 */
@Component({ selector: 'gesture-root', template: '<ng-content />' })
export class GestureRoot {
  constructor() {
    const android = nativePlatform() === 'android';
    registerViewName('gesture-root', android ? 'RNGestureHandlerRootView' : 'RCTView', {
      flex: 1,
    });
    claimHost(inject(ElementRef).nativeElement as HostNode);
    // The library does this in its root view's render: it installs the JSI bindings the new
    // architecture needs, and it can only happen once Fabric is there to install them into.
    maybeInitializeFabric();
  }
}
