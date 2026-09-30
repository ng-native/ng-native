/**
 * The view that measures the safe area and reports it, for the layouts that need the numbers.
 *
 * ```html
 * <safe-area-provider>
 *   <native-stack-outlet />
 * </safe-area-provider>
 * ```
 *
 * One, at the root, wrapping everything. What it measures is its own frame and the insets around
 * it, which is why it has to be the thing filling the window rather than a view somewhere inside
 * it. It fills by default and paints nothing.
 *
 * **A `<safe-area-view>` needs one above it**, which is less obvious than it sounds. The native
 * view walks its superviews for a provider and falls back to reading its own insets - but only
 * once, as it enters the window, before it has been laid out, and nothing notifies it when they
 * change. With no provider it therefore insets by zero and looks like it is working, until a later
 * update to that view happens to re-read them and the content jumps.
 *
 * That is also why a presented screen needs its own: it is outside the stack's view tree, which
 * is the same reason it has no header. Give a modal a provider of its own with
 * `[reportInsets]="false"`, so its geometry stays out of the app-wide `SafeArea` while it is up.
 */
import {
  Component,
  DestroyRef,
  ElementRef,
  Renderer2,
  booleanAttribute,
  inject,
  input,
} from '@angular/core';
import { SafeArea, type Frame, type Insets } from '@ng-native/device';
import { Engine, claimHost, type HostNode } from '@ng-native/fabric';
import { registerSafeAreaComponents } from './safe-area.ts';

/** The insets, in the form the cascade carries: one custom property per edge, in points. */
function insetTokens(insets: Insets): Record<string, { length: number }> {
  return {
    '--safe-area-inset-top': { length: insets.top },
    '--safe-area-inset-right': { length: insets.right },
    '--safe-area-inset-bottom': { length: insets.bottom },
    '--safe-area-inset-left': { length: insets.left },
  };
}

interface InsetsChange {
  readonly insets: Insets;
  readonly frame: Frame;
}

@Component({
  selector: 'safe-area-provider',
  template: '<ng-content />',
})
export class SafeAreaProvider {
  /**
   * Whether what this measures becomes `SafeArea.insets`. The app has one safe area; a second
   * provider inside a modal is there so native descendants can find one, not to redefine it.
   */
  readonly reportInsets = input(true, { transform: booleanAttribute });

  constructor() {
    registerSafeAreaComponents();
    const host = inject(ElementRef).nativeElement as HostNode;
    claimHost(host);

    const area = inject(SafeArea);
    const engine = inject(Engine, { optional: true });
    const stop = inject(Renderer2).listen(
      host,
      'insetsChange',
      (event: { nativeEvent?: InsetsChange }) => {
        const change = event?.nativeEvent;
        if (!change || !this.reportInsets()) return;
        area.report(change.insets, change.frame);
        // Also published to the stylesheet, where a padding that clears the home indicator
        // belongs. `env()` on the web; a seeded custom property here.
        engine?.updateTokens(insetTokens(change.insets));
      },
    );
    inject(DestroyRef).onDestroy(stop);
  }
}
