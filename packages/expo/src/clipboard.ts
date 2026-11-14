/**
 * `Clipboard`, bound to `expo-clipboard`.
 *
 * The package's JavaScript is used here rather than the native module, because it does real work:
 * it carries the event name the change listener subscribes to, and the option defaults each call
 * expects. `expo-haptics`'s JavaScript adds none of that, which is why `./haptics.ts` skips it.
 */
import { DestroyRef, InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import { expoModule, presence, present } from './native.ts';

/** The slice of `expo-clipboard` this needs. */
export interface NativeClipboard {
  getStringAsync(): Promise<string>;
  setStringAsync(text: string): Promise<boolean>;
  addClipboardListener(listener: () => void): { remove(): void };
}

/** The desktop host's slice of the clipboard: everything but the change listener. */
type DesktopClipboard = Omit<NativeClipboard, 'addClipboardListener'>;

/**
 * The desktop host's `NgNativeClipboard`, with the change listener on its `ngNativeClipboard`
 * event: a TurboModule cannot hand back the subscription `addClipboardListener` answers. Null
 * where the host has no such module.
 */
function desktopClipboard(): NativeClipboard | null {
  const native = require('react-native') as {
    TurboModuleRegistry: { get(name: string): unknown };
    DeviceEventEmitter: {
      addListener(event: string, listener: () => void): { remove(): void };
    };
  };
  const module = native.TurboModuleRegistry.get('NgNativeClipboard') as DesktopClipboard | null;
  if (!module) return null;
  return {
    getStringAsync: () => module.getStringAsync(),
    setStringAsync: (text) => module.setStringAsync(text),
    addClipboardListener: (listener) =>
      native.DeviceEventEmitter.addListener('ngNativeClipboard', () => listener()),
  };
}

/**
 * `changes` counts pasteboard changes rather than holding the contents, and that is deliberate:
 * on iOS 16 and later, *reading* the clipboard prompts the user for permission. A signal that
 * held the text would prompt on every change, including changes made by other apps, which is
 * both a terrible experience and a good way to have the read denied. So the notification is free
 * and the read is explicit.
 *
 * The listener lives as long as the app does, and is removed when the app is destroyed: a root
 * service is one per app, not one per process, and an app that is mounted and unmounted - by a
 * test, a reload, a host embedding it - would otherwise leave one listener behind each time.
 */
@Service()
export class Clipboard {
  /** Overridden in a test to drive the pasteboard without one. */
  static readonly SOURCE = new InjectionToken<NativeClipboard | null>(
    'angular-native.clipboardSource',
    {
      factory: () => {
        const expo = expoModule(
          'expo-clipboard',
          () => require('expo-clipboard') as typeof import('expo-clipboard'),
          { desktop: desktopClipboard },
        );
        if (!expo) return null;
        // Missing from the build: the stand-in, to say so when it is used.
        if (!present(expo)) return expo as never;
        return {
          getStringAsync: () => expo.getStringAsync(),
          setStringAsync: (text) => expo.setStringAsync(text),
          addClipboardListener: (listener) => expo.addClipboardListener(listener),
        };
      },
    },
  );

  private readonly native = inject(Clipboard.SOURCE);

  /** Whether the module is here. False where the service is absent, and every call is inert. */
  readonly available: Signal<boolean> = presence(this.native);
  private readonly count = signal(0);

  /** How many times the pasteboard has changed since the app started reading it. */
  readonly changes: Signal<number> = this.count.asReadonly();

  constructor() {
    const listener = present(this.native)?.addClipboardListener(() =>
      this.count.update((n) => n + 1),
    );
    if (listener) inject(DestroyRef).onDestroy(() => listener.remove());
  }

  /** What is on the clipboard. On iOS 16+ this is what asks the user for permission. */
  read(): Promise<string> {
    return this.native?.getStringAsync() ?? Promise.resolve('');
  }

  /** Put text on the clipboard. Resolves once native has it. */
  async write(text: string): Promise<void> {
    await this.native?.setStringAsync(text);
  }
}
