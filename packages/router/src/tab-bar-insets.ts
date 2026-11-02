/**
 * How much of the bottom of the window the tab bar covers now, for what is drawn outside the tabs.
 *
 * `<tab-safe-area-view>` keeps content inside a tab clear of the bar. An overlay at the root of the
 * app, beside the root `<native-stack-outlet>`, is in no tab, and the insets it has are the
 * window's. Reading this keeps it above the bar, and it follows the bar being hidden or covered.
 */
import { Service, computed, signal, type Signal, type WritableSignal } from '@angular/core';

/** `TabBarModule` in `@ng-native/expo`, the Android half. */
export interface NativeTabBar {
  addListener?(
    event: 'onTabBarHeight',
    listener: (change: { readonly host: number; readonly height: number }) => void,
  ): { remove(): void };
  watch?(host: number): Promise<boolean> | undefined;
  unwatch?(host: number): Promise<void> | undefined;
}

/** Reached by name, as `@ng-native/device` reaches `expo-navigation-bar`. Absent in Expo Go. */
export function nativeTabBar(): NativeTabBar | undefined {
  const modules = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
  return modules?.['NgNativeTabBar'] as NativeTabBar | undefined;
}

/** Add `item` to the set `items` holds. Answers its withdrawal. */
export function withdrawable<T>(items: WritableSignal<ReadonlySet<T>>, item: T): () => void {
  items.update((held) => new Set(held).add(item));
  return () =>
    items.update((held) => {
      const rest = new Set(held);
      rest.delete(item);
      return rest;
    });
}

@Service()
export class TabBarInsets {
  private readonly bars = signal<ReadonlySet<Signal<number>>>(new Set());

  /**
   * The points the tab bar covers along the bottom of the window, 0 while no bar shows there. With
   * several bars on screen, the tallest.
   */
  readonly bottom: Signal<number> = computed(() =>
    Math.max(0, ...[...this.bars()].map((bar) => bar())),
  );

  /** Called by `<native-tabs-outlet>`, not for apps. Answers the withdrawal. */
  add(bar: Signal<number>): () => void {
    return withdrawable(this.bars, bar);
  }
}
