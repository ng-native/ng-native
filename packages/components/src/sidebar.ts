import {
  Component,
  computed,
  inject,
  input,
  model,
  type OnDestroy,
  type OnInit,
} from '@angular/core';
import { nativePlatform, registerViewName } from '@ng-native/fabric';
import { optionalNumber } from './transforms.ts';
import { SplitView } from './split-view.ts';
import { ViewBase } from './view-base.ts';

/**
 * On macOS the sidebar pane of the desktop host's split view, which owns its width: Yoga gets the
 * pane's frame back from the host. Elsewhere a view, drawn here.
 */
registerViewName('sidebar', { ios: 'View', android: 'View', macos: 'NgNativeSidebar' });

/** The width a drawn sidebar starts at, in points, where nothing styles one. */
const DRAWN_WIDTH = 240;

/** A selectable row of the sidebar, as the sidebar sees it. */
export interface SidebarRow {
  /** Deselect, because another row of the same sidebar was chosen. */
  deselect(): void;
}

/**
 * The sidebar of a `<split-view>`. Its `<sidebar-section>`s and `<sidebar-item>`s are a source
 * list on macOS, an NSOutlineView; anything else in it (a search field, a footer) is drawn and
 * styled by CSS on every OS.
 *
 * `[(collapsed)]` follows the title bar's sidebar button, View > Show Sidebar and a drag that shuts
 * it, on macOS. `minWidth` and `maxWidth` bound a drag of the divider, and `autosave` names where
 * macOS keeps the width and collapsed state across launches. Drawn, a collapsed sidebar is hidden,
 * the widths bound its style, and `autosave` is ignored.
 */
@Component({
  selector: 'sidebar',
  template: '<ng-content />',
  host: {
    '[collapsed]': 'native ? collapsed() : undefined',
    '[paneMinWidth]': 'native ? minWidth() : undefined',
    '[paneMaxWidth]': 'native ? maxWidth() : undefined',
    '[autosaveName]': 'native ? autosave() : undefined',
    '[style.display]': "hidden() ? 'none' : undefined",
    '[style.width]': 'drawnWidth()',
    '[style.minWidth]': 'native ? undefined : minWidth()',
    '[style.maxWidth]': 'native ? undefined : maxWidth()',
    '[style.flex]': 'split?.stacked() ? 1 : undefined',
  },
})
export class Sidebar extends ViewBase implements OnInit, OnDestroy {
  protected readonly split = inject(SplitView, { optional: true });
  /** Whether the desktop host draws this sidebar. */
  protected readonly native = nativePlatform() === 'macos';

  /** Whether the sidebar is shut. Kept in step with the user's own toggles on macOS. */
  readonly collapsed = model(false);
  /** The narrowest a drag of the divider leaves it, in points. */
  readonly minWidth = input(undefined, { transform: optionalNumber });
  /** The widest a drag of the divider leaves it, in points. */
  readonly maxWidth = input(undefined, { transform: optionalNumber });
  /** macOS: the name the width and collapsed state are kept under across launches. */
  readonly autosave = input<string>();

  private readonly rows = new Set<SidebarRow>();
  private stopCollapsed: (() => void) | null = null;

  /** Drawn, hidden while collapsed beside the content, or while a stack shows the content. */
  protected readonly hidden = computed(() => {
    if (this.native) return false;
    if (this.split?.stacked()) return this.split.showing() === 'content';
    return this.collapsed();
  });

  /** Drawn beside the content, a column of a set width that the app's style can override. */
  protected readonly drawnWidth = computed(() =>
    this.native || this.split?.stacked() ? undefined : DRAWN_WIDTH,
  );

  override ngOnInit(): void {
    super.ngOnInit();
    if (!this.native || this.stopCollapsed) return;
    this.stopCollapsed = this.engine.setEventListener(this.node, 'topSidebarCollapse', (event) => {
      const { target, nativeEvent } = event as {
        target?: unknown;
        nativeEvent?: { collapsed?: unknown };
      };
      // A sidebar inside this one's content reports its own.
      if (target !== this.node) return;
      if (typeof nativeEvent?.collapsed === 'boolean') this.collapsed.set(nativeEvent.collapsed);
    });
  }

  ngOnDestroy(): void {
    this.stopCollapsed?.();
  }

  /** Called by a row of this sidebar as it is created; answers the call that takes it away. */
  addRow(row: SidebarRow): () => void {
    this.rows.add(row);
    return () => this.rows.delete(row);
  }

  /** A row was chosen: the sidebar selects one row at a time, so every other one is deselected. */
  chose(row: SidebarRow): void {
    for (const other of this.rows) if (other !== row) other.deselect();
    this.split?.showContent();
  }
}
