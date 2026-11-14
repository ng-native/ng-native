/**
 * How a desktop app lives and ends: whether it survives its last window, and what runs before it
 * quits. Configured in code with `provideAppLifecycle`, each value defaulting to the OS's own
 * convention. On iOS and Android the OS ends an app, so nothing here runs there.
 */
import {
  InjectionToken,
  Service,
  inject,
  makeEnvironmentProviders,
  type EnvironmentProviders,
} from '@angular/core';
import { injectOs } from './os.ts';

export interface AppLifecycleOptions {
  /**
   * Whether closing the last window quits the app. Defaults to the OS's convention: false on
   * macOS, where an app stays running in the Dock and a click there opens its main window again.
   */
  readonly quitWhenLastWindowCloses?: boolean;
}

/** What `provideAppLifecycle` was given; nothing where it was not called. */
export const APP_LIFECYCLE_OPTIONS = new InjectionToken<AppLifecycleOptions>(
  'angular-native.appLifecycleOptions',
  { factory: () => ({}) },
);

/** Configure how the app lives on a desktop OS. Each option left out follows the OS. */
export function provideAppLifecycle(options: AppLifecycleOptions): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: APP_LIFECYCLE_OPTIONS, useValue: options }]);
}

/**
 * Whether an app on `os` quits when its last window closes, unless it says otherwise. macOS keeps
 * it running. A desktop OS added later quits, as Windows and Linux apps do; on a phone or tablet
 * OS the question does not arise.
 */
export const quitsWithLastWindow = (os: string): boolean => os !== 'macos' && os !== 'ios';

/** How long `willQuit` handlers have, together, before the app quits without them. */
export const WILL_QUIT_DEADLINE_MS = 5000;

type WillQuit = () => void | Promise<void>;

@Service()
export class AppLifecycle {
  private readonly options = inject(APP_LIFECYCLE_OPTIONS);
  private readonly os = injectOs();
  private readonly handlers = new Set<WillQuit>();

  /** Whether closing the last window quits the app: the option given, or the OS's convention. */
  readonly quitWhenLastWindowCloses: boolean =
    this.options.quitWhenLastWindowCloses ?? quitsWithLastWindow(this.os);

  /**
   * Run `handler` when the app is about to quit, after every window's `canClose` guard has agreed.
   * The app waits for what it returns, for at most five seconds across every handler. Answers the
   * function that removes it.
   */
  willQuit(handler: WillQuit): () => void {
    this.handlers.add(handler);
    return () => void this.handlers.delete(handler);
  }

  /**
   * Run every `willQuit` handler, together, and settle once each has or the deadline has passed.
   * A handler that throws or rejects does not keep the app from quitting. What `AppWindows` runs
   * as the host asks to quit.
   */
  async runWillQuit(deadline: number = WILL_QUIT_DEADLINE_MS): Promise<void> {
    const running = [...this.handlers].map(async (handler) => {
      try {
        await handler();
      } catch (error) {
        console.error('[angular-native] A willQuit handler failed:', error);
      }
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<void>((resolve) => (timer = setTimeout(resolve, deadline)));
    try {
      await Promise.race([Promise.all(running), late]);
    } finally {
      clearTimeout(timer);
    }
  }
}
