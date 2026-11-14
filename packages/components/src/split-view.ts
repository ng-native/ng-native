import { Component, DestroyRef, computed, inject, signal, type Signal } from '@angular/core';
import { HardwareBack, Screen } from '@ng-native/device';
import { nativePlatform, registerViewName } from '@ng-native/fabric';
import { ViewBase } from './view-base.ts';

/**
 * On macOS the desktop host draws a split view: an NSSplitViewController for the first one in a
 * window, a plain NSSplitView for any other. Every other OS draws it here, from views: two
 * columns, or at a compact width a stack whose root is the sidebar.
 */
registerViewName('split-view', { ios: 'View', android: 'View', macos: 'NgNativeSplitView' });
registerViewName('split-view-content', {
  ios: 'View',
  android: 'View',
  macos: 'NgNativeSplitContent',
});

/** Which pane a split view shows: both side by side, or one of them as a stack's top. */
export type SplitViewShowing = 'both' | 'sidebar' | 'content';

/** The content pane: everything in a `<split-view>` but its `<sidebar>`. */
@Component({
  selector: 'split-view-content',
  template: '<ng-content />',
  host: { '[style.display]': "split.showing() === 'sidebar' ? 'none' : undefined" },
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
 * sidebar and the toolbar's sidebar button; a nested or second one is a plain NSSplitView. On
 * every other OS it is drawn: two columns, and at a compact width (`Screen.compact`) a stack whose
 * root is the sidebar. There, choosing an item shows the content, and `showSidebar()` (or
 * Android's back button) returns to the sidebar.
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
  /** Whether this split view is drawn from views here, rather than by the desktop host. */
  readonly drawn = nativePlatform() !== 'macos';
  private readonly compact = inject(Screen).compact;
  private readonly top = signal<'sidebar' | 'content'>('sidebar');

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
  }

  /** Show the content over the sidebar, where the panes are a stack. A choice in the sidebar does. */
  showContent(): void {
    this.top.set('content');
  }

  /**
   * Go back to the sidebar, where the panes are a stack and the content is in front. Whether it
   * did, so Android's back button leaves the app from the sidebar.
   */
  showSidebar(): boolean {
    if (this.showing() !== 'content') return false;
    this.top.set('sidebar');
    return true;
  }
}
