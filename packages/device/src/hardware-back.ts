/**
 * Android's hardware back button.
 *
 * Not a signal, because a press is a question rather than a state: the platform asks whether
 * anybody wants it, and the answer decides what happens next. A handler returns whether it
 * consumed the press, and returning false lets the platform do what it would have done - at the
 * bottom of a navigation stack that means backgrounding the app rather than closing it, so a user
 * who backs out of the first screen finds the app where they left it.
 */
import { InjectionToken, Service, inject, type Signal } from '@angular/core';
import { reactNative } from './react-native.ts';
import { SCREEN_IN_FRONT } from './screen-in-front.ts';

/** Angular's NG0203, `inject()` called outside an injection context. */
const NO_INJECTION_CONTEXT = -203;

export interface HardwareBackSource {
  subscribe(listener: () => boolean): () => void;
}

export function hardwareBackSource(): HardwareBackSource {
  const native = reactNative();
  if (!native) return { subscribe: () => () => {} };

  return {
    subscribe: (listener) => {
      const subscription = native.BackHandler.addEventListener('hardwareBackPress', listener);
      return () => subscription.remove();
    },
  };
}

@Service()
export class HardwareBack {
  /** Overridden in a test to press the button without a device. */
  static readonly SOURCE = new InjectionToken<HardwareBackSource>(
    'angular-native.hardwareBackSource',
    { factory: hardwareBackSource },
  );

  private readonly source = inject(HardwareBack.SOURCE);

  /**
   * Handle the back press. React Native runs the most recently added handler first, so a screen
   * that subscribes on mount outranks the one below it. Called in a screen's injection context, as
   * from its constructor, the handler is asked only while that screen is in front: a screen pushed
   * or presented over it gets the press. Returns an unsubscribe.
   */
  handle(handler: () => boolean): () => void {
    const inFront = callerInFront();
    return this.source.subscribe(() => (inFront?.() ?? true) && handler());
  }
}

/** Whether the screen the caller is on is in front, or null where nothing says: outside an injection context, or one with no screen. */
function callerInFront(): Signal<boolean> | null {
  try {
    return inject(SCREEN_IN_FRONT, { optional: true });
  } catch (error) {
    if ((error as { code?: number }).code !== NO_INJECTION_CONTEXT) throw error;
    return null;
  }
}
