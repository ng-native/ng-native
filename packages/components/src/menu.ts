/**
 * Menus written as elements: `<menu-bar>`, `<menu-group>`, `<menu-item>` and `<menu-separator>`.
 * They draw nothing themselves. Each item registers itself with the menu it is written in, through
 * `MENU_MODEL`, and the menu's owner draws it: `Menus` sends a `<menu-bar>` to the host, and a
 * `[contextMenu]` or a `<native-header-item [menu]>` reads a template of items.
 */
import {
  Component,
  DestroyRef,
  ElementRef,
  booleanAttribute,
  computed,
  inject,
  input,
  model,
  output,
  type OutputEmitterRef,
  type Signal,
} from '@angular/core';
import {
  MENU_MODEL,
  Menus,
  menuModelInTreeOrder,
  type MenuEntry,
  type MenuGroupRole,
  type MenuRole,
} from '@ng-native/device';
import type { EngineNode } from '@ng-native/fabric';

export { menuModelInTreeOrder, treeOrder } from '@ng-native/device';

/** Register `entry` with the menu the element is written in, and take it out as it goes. */
function registerIn(entry: Signal<MenuEntry>, element: string): void {
  const menu = inject(MENU_MODEL, { optional: true, skipSelf: true });
  if (!menu) {
    console.warn(
      `[angular-native] <${element}> is outside a menu: write it in a <menu-bar>, a ` +
        '<menu-group>, or a template given to [contextMenu] or <native-header-item [menu]>.',
    );
    return;
  }
  const node = inject(ElementRef).nativeElement as EngineNode;
  inject(DestroyRef).onDestroy(menu.register(entry, node));
}

/** Count an output's listeners, so an item knows whether the app handles it. */
function listened(emitter: OutputEmitterRef<void>): () => boolean {
  let listeners = 0;
  const subscribe = emitter.subscribe.bind(emitter);
  emitter.subscribe = (callback) => {
    listeners++;
    const subscription = subscribe(callback);
    return {
      unsubscribe: () => {
        listeners--;
        subscription.unsubscribe();
      },
    };
  };
  return () => listeners > 0;
}

/**
 * One item of a menu. `(select)` fires when it is chosen, and a `[(checked)]` item toggles. An
 * item with a `menuRole` and no `(select)` does what the OS does for that role.
 */
@Component({
  selector: 'menu-item',
  template: '',
  host: { '[style.display]': '"none"' },
})
export class MenuItem {
  readonly label = input('');
  /** What the item is for, where the OS has a standard one: it replaces that default. */
  readonly menuRole = input<MenuRole>();
  /** `mod+s`: Cmd on Apple's OSes, Ctrl on Android. */
  readonly shortcut = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });
  /** A check mark. Bound two-way, it toggles as the item is chosen. */
  readonly checked = model<boolean | undefined>(undefined);
  readonly destructive = input(false, { transform: booleanAttribute });
  readonly subtitle = input<string>();
  /** An SF Symbol, on Apple's OSes. */
  readonly sfSymbol = input<string>();
  /** A drawable resource's name, on Android. */
  readonly icon = input<string>();
  readonly select = output<void>();

  private readonly handled = listened(this.select);

  constructor() {
    registerIn(
      computed(() => {
        const checked = this.checked();
        const role = this.menuRole();
        // An item with a role and no handler is the OS's: no `select`, so the host does it.
        const own = !role || this.handled() || checked !== undefined;
        return {
          label: this.label(),
          ...(role && { menuRole: role }),
          ...(this.shortcut() && { shortcut: this.shortcut() }),
          ...(this.disabled() && { disabled: true }),
          ...(checked !== undefined && { checked }),
          ...(this.destructive() && { destructive: true }),
          ...(this.subtitle() && { subtitle: this.subtitle() }),
          ...(this.sfSymbol() && { sfSymbol: this.sfSymbol() }),
          ...(this.icon() && { icon: this.icon() }),
          ...(own && { select: () => this.chosen() }),
        };
      }),
      'menu-item',
    );
  }

  private chosen(): void {
    if (this.disabled()) return;
    const checked = this.checked();
    if (checked !== undefined) this.checked.set(!checked);
    this.select.emit();
  }
}

/** A line between items. */
@Component({
  selector: 'menu-separator',
  template: '',
  host: { '[style.display]': '"none"' },
})
export class MenuSeparator {
  constructor() {
    registerIn(
      computed(() => ({ separator: true }) as const),
      'menu-separator',
    );
  }
}

/**
 * A submenu, a section of the menu it is in (`inline`), or in a `<menu-bar>` a menu of the bar. In
 * a bar, a `menuRole` of `app`, `file`, `edit`, `view`, `window` or `help` adds its items to that
 * standard menu.
 */
@Component({
  selector: 'menu-group',
  template: '<ng-content />',
  host: { '[style.display]': '"none"' },
  providers: [{ provide: MENU_MODEL, useFactory: menuModelInTreeOrder }],
})
export class MenuGroup {
  readonly label = input('');
  readonly menuRole = input<MenuGroupRole>();
  readonly inline = input(false, { transform: booleanAttribute });
  readonly sfSymbol = input<string>();
  readonly icon = input<string>();
  readonly destructive = input(false, { transform: booleanAttribute });

  private readonly own = inject(MENU_MODEL, { self: true });

  constructor() {
    registerIn(
      computed(() => ({
        label: this.label(),
        items: this.own.entries(),
        ...(this.menuRole() && { group: this.menuRole() }),
        ...(this.inline() && { inline: true }),
        ...(this.sfSymbol() && { sfSymbol: this.sfSymbol() }),
        ...(this.icon() && { icon: this.icon() }),
        ...(this.destructive() && { destructive: true }),
      })),
      'menu-group',
    );
  }
}

/**
 * The app's menus in the menu bar, merged with the menus every desktop app has: App, Edit, View,
 * Window and Help. On macOS and iPadOS it is the menu bar. On iPhone and Android nothing is drawn,
 * and the items' shortcuts work from a hardware keyboard. It can be anywhere in the app, and
 * follows what its items say for as long as it is there.
 */
@Component({
  selector: 'menu-bar',
  template: '<ng-content />',
  host: { '[style.display]': '"none"' },
  providers: [{ provide: MENU_MODEL, useFactory: menuModelInTreeOrder }],
})
export class MenuBar {
  constructor() {
    const own = inject(MENU_MODEL, { self: true });
    inject(DestroyRef).onDestroy(inject(Menus).addMenuBar(own.entries));
  }
}
