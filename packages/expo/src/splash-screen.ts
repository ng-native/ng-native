/**
 * `SplashScreen`, bound to `expo-splash-screen`. Held until the app has something worth showing.
 *
 * The whole point is the ordering, and it is easy to get subtly wrong: the native screen hides
 * itself as soon as the first frame is drawn, so an app that loads fonts before mounting shows a
 * blank window for as long as that takes. Preventing the auto-hide has to happen at module scope,
 * before any of that, and hiding has to happen after the first real frame:
 *
 * ```ts
 * import { splashScreen } from '@ng-native/expo/splash-screen';
 * import { loadFonts } from '@ng-native/expo/fonts';
 *
 * // At module scope, before anything renders.
 * splashScreen.hold();
 *
 * AppRegistry.registerRunnable('main', ({ rootTag }) => {
 *   const fonts = loadFonts(styleSheetOf(GlobalStyles));
 *   mount(Number(rootTag), App, getFabricUIManager(), { globalStyles: styleSheetOf(GlobalStyles) });
 *   void splashScreen.hideWhenReady(fonts);
 * });
 * ```
 *
 * Mounting does not wait for the fonts; the splash screen does. Text laid out before they arrive
 * is laid out again as each face registers, behind the splash, so nothing is ever seen in the
 * fallback face.
 *
 * `hideWhenReady` is that shape as one call, which is the only thing worth wrapping here: every
 * function underneath is already a plain promise with no React in it. The class takes its
 * platform rather than injecting it, because the first call happens before there is an injector.
 */
import { InjectionToken } from '@angular/core';
import { expoModule } from './native.ts';

/** The slice of `expo-splash-screen` this needs. */
export interface NativeSplashScreen {
  preventAutoHideAsync(): Promise<boolean>;
  hideAsync(): Promise<void>;
}

export function expoSplashScreen(): NativeSplashScreen | null {
  const expo = expoModule(
    'expo-splash-screen',
    () => require('expo-splash-screen') as typeof import('expo-splash-screen'),
  );
  if (!expo) return null;
  return {
    preventAutoHideAsync: () => expo.preventAutoHideAsync(),
    hideAsync: () => expo.hideAsync(),
  };
}

export class Splash {
  private readonly source: NativeSplashScreen | null | (() => NativeSplashScreen | null);
  private resolved: { readonly native: NativeSplashScreen | null } | null = null;
  private held = false;

  /**
   * The module, or a function that reaches it: the shared instance is created when its file is
   * imported, and reaching the module then would fail an import rather than the first call.
   */
  constructor(native: NativeSplashScreen | null | (() => NativeSplashScreen | null)) {
    this.source = native;
  }

  private get native(): NativeSplashScreen | null {
    this.resolved ??= {
      native: typeof this.source === 'function' ? this.source() : this.source,
    };
    return this.resolved.native;
  }

  /** Whether the module is installed. Without it the screen hides itself on the first frame. */
  get available(): boolean {
    return this.native !== null;
  }

  /**
   * Keep the splash up. Called at module scope, before anything is mounted.
   *
   * Failures are swallowed: the only ones are races with the screen already having gone, and an
   * app that cannot hold its splash should still start.
   */
  hold(): void {
    if (!this.native || this.held) return;
    this.held = true;
    void this.native.preventAutoHideAsync().catch(() => {});
  }

  /** Let it go. Safe to call whether or not it was ever held. */
  async hide(): Promise<void> {
    if (!this.native) return;
    this.held = false;
    await this.native.hideAsync().catch(() => {});
  }

  /**
   * Hide once `work` is done *and* the first frame after it has been drawn.
   *
   * Hiding the moment the work resolves uncovers the frame that was on screen while it ran, which
   * is the empty one. Waiting a frame is what makes the handover invisible, and is why this is a
   * method rather than two calls at a call site.
   */
  async hideWhenReady(work: Promise<unknown>, nextFrame = defaultFrame): Promise<void> {
    try {
      await work;
    } finally {
      await nextFrame();
      await this.hide();
    }
  }
}

/** One turn of the frame loop, or the macrotask queue where there is no loop to wait on. */
const defaultFrame = (): Promise<void> =>
  new Promise((resolve) => {
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => void })
      .requestAnimationFrame;
    if (raf) raf(() => resolve());
    else setTimeout(resolve, 0);
  });

/**
 * The one instance, exported directly because it is needed before an injector exists: holding the
 * splash is the first thing an entry file does.
 */
export const splashScreen = new Splash(expoSplashScreen);

export const SplashScreen = new InjectionToken<Splash>('angular-native.splashScreen', {
  factory: () => splashScreen,
});
export type SplashScreen = Splash;
