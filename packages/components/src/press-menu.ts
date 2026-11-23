import {
  DestroyRef,
  Directive,
  ElementRef,
  InjectionToken,
  Injector,
  forwardRef,
  inject,
  input,
  untracked,
  type TemplateRef,
} from '@angular/core';
import { Menus, OS } from '@ng-native/device';
import { HostEngine, type HostNode } from '@ng-native/fabric';
import { templateMenu } from './context-menu.ts';

/** The `[menu]` on a `<pressable>`, which a press opens instead of firing `(press)`. */
export const PRESS_MENU = new InjectionToken<{ open(): boolean }>('angular-native.pressMenu');

declare const ngDevMode: unknown;

/** Whether the warning for a host that draws no press menu has been given, which it is once. */
let warned = false;

/**
 * A menu a press opens: `<pressable [menu]="menu">`, with `<ng-template #menu>` holding
 * `<menu-item>`s, as a `[contextMenu]` is written. A click, a screen reader's press or, on macOS,
 * Space on the focused element opens it under the element, and `(press)` does not fire. A pop-up
 * select is a menu of `[checked]` items. `open()` opens it from code: `#sort="pressMenu"` names it in
 * the template.
 *
 * macOS draws it as an `NSMenu` under the element, and Linux as a popover menu below it. Other
 * hosts draw none yet: there a press fires `(press)`, with one warning in development.
 *
 * The host contract: `Menus.popUpMenu(view, entries)` with the view's tag and the menu as
 * `serializeMenu` makes it. The host sends the item chosen as the view's `topContextMenuSelect`,
 * as a context menu's.
 */
@Directive({
  selector: 'pressable[menu]',
  exportAs: 'pressMenu',
  providers: [{ provide: PRESS_MENU, useExisting: forwardRef(() => PressMenu) }],
})
export class PressMenu {
  readonly menu = input<TemplateRef<unknown> | null>();

  private readonly node = inject(ElementRef).nativeElement as HostNode;
  private readonly engine = inject(HostEngine);
  private readonly menus = inject(Menus);
  private readonly built = templateMenu(() => this.menu() ?? null, inject(Injector), inject(OS));

  constructor() {
    const stop = this.engine.setEventListener(this.node, 'topContextMenuSelect', (event) => {
      const id = (event as { nativeEvent?: { id?: string } }).nativeEvent?.id;
      if (id !== undefined) this.built.choose(id);
    });
    inject(DestroyRef).onDestroy(stop);
  }

  /**
   * Open the menu under the element now. False when it opened none: it shows no item, the element
   * has no view yet, or the host draws no press menu.
   */
  open(): boolean {
    const entries = untracked(this.built.sent);
    if (!entries) return false;
    if (!this.menus.popsUpMenus) {
      if (typeof ngDevMode !== 'undefined' && ngDevMode && !warned) {
        warned = true;
        console.warn(
          '[menu] on a <pressable>: this host draws no menu on a press yet (macOS and Linux ' +
            'do), so the press fires (press) instead.',
        );
      }
      return false;
    }
    const view = this.engine.tagOf?.(this.node) ?? null;
    if (view === null) return false;
    this.menus.popUpMenu(view, entries);
    return true;
  }
}
