import {
  DestroyRef,
  Directive,
  ElementRef,
  InjectionToken,
  Injector,
  effect,
  forwardRef,
  inject,
  input,
  signal,
  untracked,
  type TemplateRef,
} from '@angular/core';
import { Menus, OS } from '@ng-native/device';
import { HostEngine, type HostNode } from '@ng-native/fabric';
import { templateMenu } from './context-menu.ts';
import { byNativeId } from './native-id.ts';

/** The `[menu]` on a `<pressable>`, which a press opens instead of firing `(press)`. */
export const PRESS_MENU = new InjectionToken<{
  /** Whether a press opened the menu, or the host's own touch did, so `(press)` does not fire. */
  takePress(): boolean;
  /** Tell it when the pressable refuses presses, so the host draws no menu then. */
  disableWhile(disabled: () => boolean): void;
}>('angular-native.pressMenu');

declare const ngDevMode: unknown;

const drawsNone =
  '[menu] on a <pressable>: this host draws no menu on a press yet (macOS, Linux, Android and ' +
  'iOS do), so the press fires (press) instead.';
const opensNoneOnIos =
  "PressMenu.open(): iOS opens a press menu only on a touch or a screen reader's press, and has " +
  'no way to open one from code, so this opens none.';

/** The warnings given in development, each once. */
const warned = new Set<string>();

function warnOnce(message: string): void {
  if (typeof ngDevMode === 'undefined' || !ngDevMode || warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/**
 * A menu a press opens: `<pressable [menu]="menu">`, with `<ng-template #menu>` holding
 * `<menu-item>`s, as a `[contextMenu]` is written. A click, a screen reader's press or, on macOS,
 * Space on the focused element opens it under the element, and `(press)` does not fire. A pop-up
 * select is a menu of `[checked]` items. `open()` opens it from code: `#sort="pressMenu"` names it in
 * the template.
 *
 * macOS draws it as an `NSMenu` under the element, Linux as a popover menu below it, Android as a
 * PopupMenu below it, and iOS as a UIMenu from a clear button laid over the element, which a touch
 * or VoiceOver's activation opens. Android and iOS take the `NgNativeMenus` module that Expo Go
 * lacks. iOS has no way to open the menu from code, so `open()` there opens none. Other hosts
 * (Expo Go, the web) draw none yet: there a press fires `(press)`, with one warning in development.
 *
 * The host contract: `Menus.popUpMenu(view, entries)` with the view's tag and the menu as
 * `serializeMenu` makes it, and the item chosen sent as the view's `topContextMenuSelect`, as a
 * context menu's. On iOS, `Menus.setPressMenu(nativeID, entries)` instead, as the menu changes, and
 * null while the pressable is disabled; the choice comes back by the view's `nativeID`.
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
  private readonly os = inject(OS);
  private readonly built = templateMenu(() => this.menu() ?? null, inject(Injector), this.os);
  /** iOS's host, which takes the menu by `nativeID` and opens it on a touch itself. */
  private readonly byNativeId = this.os === 'ios' && this.menus.pressMenuByNativeId;
  private readonly disabled = signal<() => boolean>(() => false);

  constructor() {
    const stop = this.engine.setEventListener(this.node, 'topContextMenuSelect', (event) => {
      const id = (event as { nativeEvent?: { id?: string } }).nativeEvent?.id;
      if (id !== undefined) this.built.choose(id);
    });
    inject(DestroyRef).onDestroy(stop);
    if (this.byNativeId) this.sendByNativeId();
  }

  disableWhile(disabled: () => boolean): void {
    this.disabled.set(disabled);
  }

  /**
   * Whether a press is the menu's: on iOS the host's own touch opened it, wherever it has the
   * menu; elsewhere `open()` opens it now.
   */
  takePress(): boolean {
    return this.byNativeId ? untracked(this.built.sent) !== null : this.open();
  }

  /**
   * Ask the host to open the menu under the element now. True once the request is sent, which
   * does not mean the menu showed: the host draws none for a view it is not showing (no window on
   * macOS, not mapped on Linux), and does not report that. False when no request is sent: the menu
   * shows no item, the element has no view yet, or the host draws no press menu, or opens it only
   * on a touch (iOS).
   */
  open(): boolean {
    const entries = untracked(this.built.sent);
    if (!entries) return false;
    if (!this.menus.popsUpMenus) {
      warnOnce(this.byNativeId ? opensNoneOnIos : drawsNone);
      return false;
    }
    const view = this.engine.tagOf?.(this.node) ?? null;
    if (view === null) return false;
    this.menus.popUpMenu(view, entries);
    return true;
  }

  /**
   * Keep the host's menu on the view as the menu and the pressable's disabled state change, by
   * its `nativeID`, and take it away as the element goes.
   */
  private sendByNativeId(): void {
    const choose = (id: string) => this.built.choose(id);
    const shown = () => (this.disabled()() ? null : this.built.sent());
    const send = byNativeId(
      this.engine,
      this.node,
      (nativeID) => this.menus.setPressMenu(nativeID, untracked(shown), choose),
      (nativeID) => this.menus.setPressMenu(nativeID, null, choose),
    );
    effect(() => {
      shown();
      send();
    });
  }
}
