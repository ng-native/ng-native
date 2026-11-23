import {
  DestroyRef,
  Directive,
  ElementRef,
  InjectionToken,
  Injector,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  signal,
  untracked,
  type Signal,
  type TemplateRef,
} from '@angular/core';
import {
  Menus,
  OS,
  buildMenuTemplate,
  serializeMenu,
  type MenuTemplate,
  type NativeMenuEntry,
  type ShortcutOs,
} from '@ng-native/device';
import { HostEngine, type HostNode } from '@ng-native/fabric';
import { byNativeId } from './native-id.ts';

/**
 * The `[contextMenu]` on an element, for `<pressable>`: where a long press opens the menu,
 * `(longPress)` does not also fire.
 */
export const CONTEXT_MENU = new InjectionToken<{ takesLongPress(): boolean }>(
  'angular-native.contextMenu',
);

/**
 * A context menu on an element: `[contextMenu]="menu"`, with `<ng-template #menu>` holding
 * `<menu-item>`s. A right-click opens it on macOS. On Android a long press or a right-click opens
 * it as a PopupMenu at the press point, and on iOS and iPadOS a long press, or a secondary click
 * from an iPad pointer, opens it through UIContextMenuInteraction. On Android and iOS that takes
 * the `NgNativeMenus` module, which Expo Go lacks, and where it is there `(longPress)` does not
 * also fire. On Android a `(longPress)` on a view inside the element keeps its long press, which
 * then opens no menu: the innermost handler wins.
 *
 * The host contract: the view takes a `contextMenu` prop, the menu as `serializeMenu` makes it
 * (null to take it away), and sends `topContextMenuSelect` with the chosen item's `id`. React
 * Native's Android and iOS views drop a prop they do not know, so there the menu goes through
 * `Menus.setContextMenu` by the view's `nativeID`, and an element without one is given one. iOS's
 * module sends the choice, which reaches the element as `topContextMenuSelect`.
 */
@Directive({
  selector: '[contextMenu]',
  providers: [{ provide: CONTEXT_MENU, useExisting: forwardRef(() => ContextMenu) }],
})
export class ContextMenu {
  readonly contextMenu = input<TemplateRef<unknown> | null>();

  private readonly node = inject(ElementRef).nativeElement as HostNode;
  private readonly engine = inject(HostEngine);
  private readonly injector = inject(Injector);
  private readonly os = inject(OS);
  private readonly menus = inject(Menus);
  /** Android's and iOS's hosts, which take the menu by `nativeID` and draw it on a long press. */
  private readonly byNativeId =
    (this.os === 'android' || this.os === 'ios') && this.menus.contextMenuByNativeId;
  private readonly sender = this.byNativeId
    ? byNativeId(
        this.engine,
        this.node,
        (nativeID) => this.sendByNativeId(nativeID),
        (nativeID) => this.menus.setContextMenu(nativeID, null),
      )
    : null;
  private readonly menu = templateMenu(() => this.contextMenu() ?? null, this.injector, this.os);
  private readonly sent = this.menu.sent;

  constructor() {
    effect(() => {
      this.engine.setProp(this.node, 'contextMenu', this.sent());
      this.sender?.();
    });
    const stop = this.engine.setEventListener(this.node, 'topContextMenuSelect', (event) => {
      const id = (event as { nativeEvent?: { id?: string } }).nativeEvent?.id;
      if (id !== undefined) this.menu.choose(id);
    });
    inject(DestroyRef).onDestroy(stop);
  }

  /** Whether a long press opens this menu now, so `(longPress)` does not also fire. */
  takesLongPress(): boolean {
    return this.byNativeId && this.sent() !== null;
  }

  /**
   * Send the menu to the host under the view's `nativeID`. On iOS the choice comes back by that
   * name, and runs as the view's own `topContextMenuSelect` would.
   */
  private sendByNativeId(nativeID: string): void {
    this.menus.setContextMenu(nativeID, untracked(this.sent), (id) => this.menu.choose(id));
  }
}

/** A menu written as a template of `<menu-item>`s, as `templateMenu` makes it. */
export interface TemplateMenu {
  /** The entries to send, or null where they show no item: only separators and empty sections. */
  readonly sent: Signal<NativeMenuEntry[] | null>;
  /** Run the item with `id`, as the menu is now: nothing for an id it no longer has. */
  choose(id: string): void;
}

/**
 * The menu `template` holds, its items made in `injector` and remade as the template changes, and
 * destroyed with it. Called in an injection context.
 */
export function templateMenu(
  template: () => TemplateRef<unknown> | null,
  injector: Injector,
  os: ShortcutOs,
): TemplateMenu {
  const built = signal<MenuTemplate | null>(null);
  const build = (next: TemplateRef<unknown> | null) =>
    // Read and written outside the effect that calls this, which would otherwise run again.
    untracked(() => {
      built()?.destroy();
      built.set(next ? buildMenuTemplate(next, injector) : null);
    });
  effect(() => build(template()));
  inject(DestroyRef).onDestroy(() => build(null));
  const menu = computed(() => serializeMenu(built()?.model.entries() ?? [], os));
  return {
    sent: computed(() => {
      const { entries } = menu();
      return showsAnItem(entries) ? entries : null;
    }),
    choose: (id) => untracked(menu).actions.get(id)?.(),
  };
}

/** Whether `entries` show an item: one that is not a separator, nor a section with none. */
function showsAnItem(entries: readonly NativeMenuEntry[]): boolean {
  return entries.some(
    (entry) => !('separator' in entry) && (!entry.inline || showsAnItem(entry.items ?? [])),
  );
}
