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
  type TemplateRef,
} from '@angular/core';
import {
  Menus,
  OS,
  buildMenuTemplate,
  serializeMenu,
  type MenuTemplate,
  type NativeMenuEntry,
} from '@ng-native/device';
import { HostEngine, type HostNode } from '@ng-native/fabric';

/**
 * The `[contextMenu]` on an element, for `<pressable>`: where a long press opens the menu,
 * `(longPress)` does not also fire.
 */
export const CONTEXT_MENU = new InjectionToken<{ takesLongPress(): boolean }>(
  'angular-native.contextMenu',
);

/** How many elements have been given a `nativeID` for their menu, for the next one's name. */
let named = 0;

/**
 * A context menu on an element: `[contextMenu]="menu"`, with `<ng-template #menu>` holding
 * `<menu-item>`s. A right-click opens it on macOS. On Android a long press or a right-click opens
 * it as a PopupMenu at the press point, where the app has the `NgNativeMenus` module, and there
 * `(longPress)` does not also fire. No iOS host draws it yet.
 *
 * The host contract: the view takes a `contextMenu` prop, the menu as `serializeMenu` makes it
 * (null to take it away), and sends `topContextMenuSelect` with the chosen item's `id`. Android's
 * view drops a prop it does not know, so there the menu goes through `Menus.setContextMenu` by the
 * view's `nativeID`, and an element without one is given one.
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
  /** Android's host, which takes the menu by `nativeID` and draws it on a long press. */
  private readonly byNativeId = this.os === 'android' && this.menus.contextMenuByNativeId;
  /** The `nativeID` the menu was last sent under, on Android. */
  private sentAs: string | null = null;
  private destroyed = false;
  private readonly built = signal<MenuTemplate | null>(null);
  private readonly menu = computed(() =>
    serializeMenu(this.built()?.model.entries() ?? [], this.os),
  );

  constructor() {
    effect(() => this.build(this.contextMenu() ?? null));
    effect(() => {
      const { entries } = this.menu();
      const sent = entries.length ? entries : null;
      this.engine.setProp(this.node, 'contextMenu', sent);
      // After the element's own props are written, so a `nativeID` the app gave it is there.
      if (this.byNativeId) this.engine.settle({ settleProps: () => this.sendByNativeId(sent) });
    });
    const stop = this.engine.setEventListener(this.node, 'topContextMenuSelect', (event) => {
      const id = (event as { nativeEvent?: { id?: string } }).nativeEvent?.id;
      if (id !== undefined) this.menu().actions.get(id)?.();
    });
    inject(DestroyRef).onDestroy(() => {
      stop();
      this.build(null);
      this.destroyed = true;
      if (this.sentAs !== null) this.menus.setContextMenu(this.sentAs, null);
    });
  }

  /** Whether a long press opens this menu now, so `(longPress)` does not also fire. */
  takesLongPress(): boolean {
    return this.byNativeId && this.menu().entries.length > 0;
  }

  /**
   * Send `entries` to Android's host under the view's `nativeID`, naming the view first where the
   * app did not. A `nativeID` the app changed since is followed, and the old one cleared.
   */
  private sendByNativeId(entries: NativeMenuEntry[] | null): void {
    if (this.destroyed) return;
    const own = this.node.props['nativeID'];
    let id = typeof own === 'string' && own ? own : null;
    if (id === null) {
      id = this.sentAs ?? `ngn-context-menu-${++named}`;
      this.engine.setProp(this.node, 'nativeID', id);
    }
    if (this.sentAs !== null && this.sentAs !== id) this.menus.setContextMenu(this.sentAs, null);
    this.sentAs = id;
    this.menus.setContextMenu(id, entries);
  }

  /** Make the template's items, which register with the menu this element sends. */
  private build(template: TemplateRef<unknown> | null): void {
    // Read and written outside the effect that calls this, which would otherwise run again.
    untracked(() => {
      this.built()?.destroy();
      this.built.set(template ? buildMenuTemplate(template, this.injector) : null);
    });
  }
}
