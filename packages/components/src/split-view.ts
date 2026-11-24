import {
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  type Signal,
} from '@angular/core';
import { HardwareBack, Screen, nativeSplitViews } from '@ng-native/device';
import { nativePlatform, registerViewName, registeredViewName } from '@ng-native/fabric';
import { ViewBase } from './view-base.ts';

/**
 * The host draws a split view on macOS: an NSSplitViewController for the first one in a window, a
 * plain NSSplitView for any other. On an iPad with the components pod it is a
 * UISplitViewController (`nativeSplitViews()`). Everywhere else it is drawn here, from views: two
 * columns, or at a compact width a stack whose root is the sidebar.
 */
registerViewName('split-view', {
  get ios() {
    return nativeSplitViews() ? 'NgNativeSplitView' : 'View';
  },
  android: 'View',
  macos: 'NgNativeSplitView',
});
registerViewName('split-view-content', {
  get ios() {
    return nativeSplitViews() ? 'NgNativeSplitContent' : 'View';
  },
  android: 'View',
  macos: 'NgNativeSplitContent',
});

declare const ngDevMode: unknown;

/** Whether a split view with no sidebar has been warned about, in development. */
let warnedNoSidebar = false;

/** Whether the host draws `element`, rather than a view drawn here. */
export function hostDraws(element: string): boolean {
  return registeredViewName(element) !== 'View';
}

/**
 * Material's expanded window width, in dp: from it Android's list-detail layout shows the list
 * pane beside the content, and below it one pane at a time.
 */
export const ANDROID_EXPANDED_WIDTH = 840;

/** Which pane a split view shows: both side by side, or one of them as a stack's top. */
export type SplitViewShowing = 'both' | 'sidebar' | 'content';

/**
 * How the desktop hosts draw a split view's content pane: `plain`, filling the space beside the
 * sidebar, or `inset`, a card with rounded corners inset from its space's edges, on the sidebar's
 * backdrop, which runs under the toolbar or header bar.
 */
export type SplitViewContentStyle = 'plain' | 'inset';

/** The content pane: everything in a `<split-view>` but its `<sidebar>`. */
@Component({
  selector: 'split-view-content',
  template: '<ng-content />',
  host: {
    '[style.display]': "split.showing() === 'sidebar' ? 'none' : undefined",
    '[contentStyle]': 'split.onDesktop ? split.contentStyle() : undefined',
  },
  styles: ':host { flex: 1; }',
})
export class SplitViewContent extends ViewBase {
  protected readonly split = inject(SplitView);
}

/**
 * A sidebar beside the app's content:
 *
 *   <split-view>
 *     <sidebar [(collapsed)]="hidden">
 *       <sidebar-section title="Library">
 *         <sidebar-item path="songs" label="Songs" sfSymbol="music.note" />
 *       </sidebar-section>
 *     </sidebar>
 *     <router-outlet />
 *   </split-view>
 *
 * On macOS the first one in a window becomes its NSSplitViewController, with the full-height
 * sidebar and the toolbar's sidebar button; a nested or second one is a plain NSSplitView. On an
 * iPad it is a UISplitViewController, whose sidebar column holds the sidebar's rows drawn here,
 * and which collapses into a stack itself at a compact width (Slide Over, a narrow Split View),
 * the sidebar its root. On an iPhone and Android it is drawn: two columns, and at a compact width (`Screen.compact`) a stack whose
 * root is the sidebar. On Android the columns wait for Material's expanded width,
 * `ANDROID_EXPANDED_WIDTH`, as its list-detail layout does. There, choosing an item shows the content, and `showSidebar()` (or
 * Android's back button) returns to the sidebar.
 *
 * `contentStyle="inset"` draws the content pane on macOS and Linux as a card with rounded corners,
 * inset from its space's edges on the sidebar's backdrop, which runs under the toolbar. The pane's
 * size, and so its layout, is the card's. iOS and Android ignore it.
 */
@Component({
  selector: 'split-view',
  imports: [SplitViewContent],
  template: `
    <ng-content select="sidebar" />
    <split-view-content><ng-content /></split-view-content>
  `,
  styles: ':host { flex: 1; }',
  host: { '[style.flexDirection]': "drawn && !stacked() ? 'row' : undefined" },
})
export class SplitView extends ViewBase {
  /**
   * macOS and Linux: the content pane `plain`, beside the sidebar, or `inset`, a rounded card on
   * the sidebar's backdrop. iOS and Android ignore it.
   */
  readonly contentStyle = input<SplitViewContentStyle>('plain');

  /** Whether this split view is drawn from views here, rather than by the host. */
  readonly drawn = !hostDraws('split-view');
  /** Whether the host is iOS's, whose split view controller pushes and pops the content. */
  private readonly stacksNatively = !this.drawn && nativePlatform() === 'ios';
  /** Whether the desktop host draws this split view: on macOS and Linux. */
  readonly onDesktop = !this.drawn && !this.stacksNatively;
  private readonly screen = inject(Screen);
  /** Too narrow for the panes side by side: below Material's expanded width on Android. */
  private readonly compact = computed(() =>
    nativePlatform() === 'android'
      ? this.screen.window().width < ANDROID_EXPANDED_WIDTH
      : this.screen.compact(),
  );
  private readonly top = signal<'sidebar' | 'content'>('sidebar');
  /** Set by its `<sidebar>`, which every split view needs: without one it is only its content. */
  hasSidebar = false;

  /** Whether the panes are a stack, one at a time: at a compact width, where it is drawn. */
  readonly stacked: Signal<boolean> = computed(() => this.drawn && this.compact());

  /** Which pane is showing. Both, unless the split view is a stack. */
  readonly showing: Signal<SplitViewShowing> = computed(() =>
    this.stacked() ? this.top() : 'both',
  );

  constructor() {
    super();
    const stop = inject(HardwareBack).handle(() => this.showSidebar());
    inject(DestroyRef).onDestroy(stop);
    afterNextRender(() => {
      if (this.hasSidebar || warnedNoSidebar) return;
      if (typeof ngDevMode !== 'undefined' && !ngDevMode) return;
      warnedNoSidebar = true;
      console.warn(
        '[angular-native] A <split-view> has no <sidebar>, so it shows its content alone, laid ' +
          'out as one view: on macOS no divider, and no second pane. Put a <sidebar> first in it.',
      );
    });
  }

  /** Show the content over the sidebar, where the panes are a stack. A choice in the sidebar does. */
  showContent(): void {
    this.top.set('content');
    if (this.stacksNatively) this.engine.dispatchCommand(this.node, 'showContent');
  }

  /**
   * Go back to the sidebar, where the panes are a stack and the content is in front. Whether it
   * did, so Android's back button leaves the app from the sidebar.
   */
  showSidebar(): boolean {
    if (this.stacksNatively) this.engine.dispatchCommand(this.node, 'showSidebar');
    if (this.showing() !== 'content') return false;
    this.top.set('sidebar');
    return true;
  }
}
