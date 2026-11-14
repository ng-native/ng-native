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
import { Menus, OS, buildMenuTemplate, serializeMenu, type MenuTemplate } from '@ng-native/device';
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
 * also fire.
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
      this.sender?.();
    });
    const stop = this.engine.setEventListener(this.node, 'topContextMenuSelect', (event) => {
      const id = (event as { nativeEvent?: { id?: string } }).nativeEvent?.id;
      if (id !== undefined) this.choose(id);
    });
    inject(DestroyRef).onDestroy(() => {
      stop();
      this.build(null);
    });
  }

  /** Whether a long press opens this menu now, so `(longPress)` does not also fire. */
  takesLongPress(): boolean {
    return this.byNativeId && this.menu().entries.length > 0;
  }

  /**
   * Send the menu to the host under the view's `nativeID`. On iOS the choice comes back by that
   * name, and runs as the view's own `topContextMenuSelect` would.
   */
  private sendByNativeId(nativeID: string): void {
    const { entries } = untracked(this.menu);
    this.menus.setContextMenu(nativeID, entries.length ? entries : null, (id) => this.choose(id));
  }

  private choose(id: string): void {
    this.menu().actions.get(id)?.();
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
