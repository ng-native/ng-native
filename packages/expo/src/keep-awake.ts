/**
 * `KeepAwake`, bound to `expo-keep-awake`.
 *
 * ```ts
 * inject(DestroyRef).onDestroy(inject(KeepAwake).hold('recording'));
 * ```
 *
 * Never a bare activate: a screen that holds the display on and never releases it is a phone that
 * never sleeps, which the user experiences as a battery fault and never attributes to the app.
 *
 * Tags are how two screens can each hold it without either releasing the other's.
 */
import {
  DestroyRef,
  InjectionToken,
  Service,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { onWindowFront, sharedBySource } from '@ng-native/device';
import { expoModule } from './native.ts';

export interface NativeKeepAwake {
  activate(tag: string): Promise<void>;
  deactivate(tag: string): Promise<void>;
  /** Calls `listener` when a window comes to the front, to be held on again. */
  onWindowFront?(listener: () => void): () => void;
}

const DEFAULT_TAG = 'angular-native';

@Service()
export class KeepAwake {
  /** Overridden in a test to record a hold without keeping a screen on. */
  static readonly SOURCE = new InjectionToken<NativeKeepAwake | null>(
    'angular-native.keepAwakeSource',
    {
      factory: () => {
        const expo = expoModule(
          'expo-keep-awake',
          () => require('expo-keep-awake') as typeof import('expo-keep-awake'),
        );
        if (!expo) return null;
        // One per module, so every app the runtime mounts holds the same screen.
        return sharedBySource(KeepAwake, expo, () => ({
          activate: (tag) => expo.activateKeepAwakeAsync(tag),
          deactivate: (tag) => expo.deactivateKeepAwake(tag),
          onWindowFront,
        }));
      },
    },
  );

  private readonly native = inject(KeepAwake.SOURCE);
  /** Every app's holds: the screen is the runtime's, not an app's. */
  private readonly window = sharedBySource(
    KeepAwakeWindow,
    this.native,
    () => new KeepAwakeWindow(this.native),
  );
  /** This app's holds not yet released, which go with it. */
  private readonly own = new Set<() => void>();

  /** The tags currently holding the screen on, so a debug screen can say which. */
  readonly holders: Signal<ReadonlySet<string>> = this.window.held.asReadonly();

  /** Whether anything currently holds the screen on. */
  readonly active: Signal<boolean> = computed(() => this.holders().size > 0);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const release of [...this.own]) release();
    });
  }

  /**
   * Hold the screen on. Returns the function that releases it, ready for `DestroyRef.onDestroy`.
   *
   * Never a bare `activate()`, because the release is the half that gets forgotten and the half
   * that matters. A hold still there when the app goes is released with it.
   */
  hold(tag = DEFAULT_TAG): () => void {
    const release = this.window.hold(tag);
    const own = () => {
      this.own.delete(own);
      release();
    };
    this.own.add(own);
    return own;
  }
}

/** The screen, as every app on one module holds it. */
class KeepAwakeWindow {
  readonly held = signal<ReadonlySet<string>>(new Set());
  /** How many holds each tag has that are not yet released. */
  private readonly counts = new Map<string, number>();
  private readonly native: NativeKeepAwake | null;

  constructor(native: NativeKeepAwake | null) {
    this.native = native;
    // Lives as long as the module, which is the runtime's.
    native?.onWindowFront?.(() => void this.holdAgain());
  }

  hold(tag: string): () => void {
    // Counted per tag: two screens of one kind hold the same one, and the native module keeps a
    // set of tags, so the first to release would otherwise let go for both.
    const count = this.counts.get(tag) ?? 0;
    this.counts.set(tag, count + 1);
    if (count === 0) {
      this.held.update((tags) => new Set(tags).add(tag));
      void this.native?.activate(tag).catch(() => {});
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.counts.get(tag) ?? 1) - 1;
      if (left > 0) {
        this.counts.set(tag, left);
        return;
      }
      this.counts.delete(tag);
      this.held.update((tags) => {
        const next = new Set(tags);
        next.delete(tag);
        return next;
      });
      void this.native?.deactivate(tag).catch(() => {});
    };
  }

  /**
   * A recreated activity's window starts without the flag, and the native module, which keeps its
   * tags for the runtime, sets it only for the first one. So every tag is let go, which clears it,
   * and taken again once it has gone, which sets it on the window now in front: the module's
   * calls are not promised to run in order. A tag released in between is not taken again.
   */
  private async holdAgain(): Promise<void> {
    const native = this.native;
    if (!native) return;
    const tags = [...this.counts.keys()];
    await Promise.allSettled(tags.map((tag) => native.deactivate(tag)));
    for (const tag of tags) {
      if (this.counts.has(tag)) void native.activate(tag).catch(() => {});
    }
  }
}
