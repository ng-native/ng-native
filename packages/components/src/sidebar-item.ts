import {
  Component,
  DestroyRef,
  computed,
  forwardRef,
  inject,
  input,
  model,
  output,
} from '@angular/core';
import { SIDEBAR_SELECTION } from '@ng-native/device';
import { nativePlatform, registerViewName } from '@ng-native/fabric';
import type { ButtonIcon } from './native-button.ts';
import { ControlBase, TouchableBase } from './pressable.ts';
import { Sidebar, type SidebarRow } from './sidebar.ts';
import { Text } from './text.ts';

/**
 * On macOS a row of the sidebar's source list, a model object the desktop host builds an
 * NSTableCellView from. An item with children is a custom row: the host puts its views in a cell
 * of its own. Elsewhere a pressable view, drawnHere here.
 */
registerViewName('sidebar-item', {
  ios: 'View',
  android: 'View',
  macos: 'NgNativeSidebarItem',
});

/** A sidebar item's picture, as on `<native-tab>` and `<native-button>`. */
export type SidebarItemIcon = ButtonIcon;

/**
 * A row of the sidebar:
 *
 *   <sidebar-item label="Inbox" sfSymbol="tray" [badge]="unread()" [(selected)]="inbox" />
 *
 * With `path`, from `@ng-native/router`, the route selects it, as a `<native-tab>`'s does, and
 * choosing it navigates there. Without, `[(selected)]` holds the selection. Either way choosing it
 * fires `(select)` and deselects the sidebar's other items.
 *
 * Content inside the element replaces the default row of icon, label and badge: its pressables
 * take clicks, and while the row is selected its host has `data-selected` for CSS to restyle it.
 */
@Component({
  selector: 'sidebar-item',
  imports: [Text],
  template: `
    <ng-content>
      @if (drawnHere) {
        <text class="sidebar-item-label">{{ label() }}</text>
        @if (badge()) {
          <text class="sidebar-item-badge">{{ badge() }}</text>
        }
      }
    </ng-content>
  `,
  styles: `
    /* A row drawn here. On macOS the host's cell is the row, and custom content fills it. */
    :host(.sidebar-item-drawn) {
      flex-direction: row;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
    }
    .sidebar-item-label {
      flex: 1;
    }
    .sidebar-item-badge {
      opacity: 0.6;
    }
  `,
  providers: [
    { provide: TouchableBase, useExisting: forwardRef(() => SidebarItem) },
    {
      provide: SIDEBAR_SELECTION,
      useFactory: () => inject(forwardRef(() => SidebarItem)).selected,
    },
  ],
  host: {
    '[label]': 'drawnHere ? undefined : label()',
    '[badge]': 'drawnHere ? undefined : badge()',
    '[sfSymbol]': 'drawnHere ? undefined : symbol()',
    '[drawable]': 'drawnHere ? undefined : drawableResource()',
    '[selected]': 'drawnHere ? undefined : selected()',
    '[attr.data-selected]': "selected() ? '' : null",
    '[class.sidebar-item-drawn]': 'drawnHere',
  },
})
export class SidebarItem extends ControlBase implements SidebarRow {
  private readonly sidebar = inject(Sidebar, { optional: true });
  /** Whether this row is drawnHere here rather than by the desktop host. */
  protected readonly drawnHere = nativePlatform() !== 'macos';

  /** The row's text, and what it is announced as. */
  readonly label = input<string>();
  /** A count or a short word at the trailing edge. */
  readonly badge = input<string | undefined, string | number | null | undefined>(undefined, {
    transform: (value) => (value == null ? undefined : String(value)),
  });
  /** An SF Symbol before the label, on macOS and iOS. */
  readonly sfSymbol = input<string>();
  /** Android: a drawable resource before the label. */
  readonly drawableName = input<string>(undefined, { alias: 'drawable' });
  /** The picture for each OS at once, as on `<native-tab>`. */
  readonly icon = input<SidebarItemIcon>();
  /** Whether this is the sidebar's selected item. A `path` from the router sets it by route. */
  readonly selected = model(false);
  /** The user chose this item. */
  readonly select = output<void>();

  protected readonly symbol = computed(() => {
    const icon = this.icon();
    return this.sfSymbol() ?? (icon && 'sfSymbol' in icon ? icon.sfSymbol : undefined);
  });

  protected readonly drawableResource = computed(() => {
    const icon = this.icon();
    return this.drawableName() ?? (icon && 'drawable' in icon ? icon.drawable : undefined);
  });

  private stopSelect: (() => void) | null = null;

  constructor() {
    super();
    const remove = this.sidebar?.addRow(this);
    if (remove) inject(DestroyRef).onDestroy(remove);
    this.press.subscribe(() => this.choose());
  }

  protected override roleByDefault(): 'button' {
    return 'button';
  }

  protected override accessibleByDefault(): boolean {
    return true;
  }

  protected override focusableByDefault(): boolean {
    return true;
  }

  /** On macOS the source list takes the click and selects the row: the responder never does. */
  protected override claims(): boolean {
    return this.drawnHere && super.claims();
  }

  override ngOnInit(): void {
    super.ngOnInit();
    if (this.drawnHere || this.stopSelect) return;
    this.stopSelect = this.engine.setEventListener(this.node, 'topSidebarSelect', (event) => {
      if ((event as { target?: unknown }).target === this.node) this.choose();
    });
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.stopSelect?.();
  }

  /** The user chose this row: select it, deselect the rest, and say so. */
  choose(): void {
    if (this.pressDisabled()) return;
    this.selected.set(true);
    this.sidebar?.chose(this);
    this.select.emit();
  }

  deselect(): void {
    this.selected.set(false);
  }
}
