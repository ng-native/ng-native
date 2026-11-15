import { Component, DestroyRef, computed, inject, input, output } from '@angular/core';
import { MENU_MODEL, Tray } from '@ng-native/device';
import { menuModelInTreeOrder } from './menu.ts';

/**
 * An icon in the macOS menu bar's status area, for as long as the element is there. Its
 * `<menu-item>`s are the menu a click opens; with none, a click fires `(press)`. On iOS and Android
 * nothing is drawn.
 */
@Component({
  selector: 'tray-icon',
  template: '<ng-content />',
  host: { '[style.display]': '"none"' },
  providers: [{ provide: MENU_MODEL, useFactory: menuModelInTreeOrder }],
})
export class TrayIcon {
  readonly title = input<string>();
  /** An SF Symbol, drawn to follow the menu bar's light or dark appearance. */
  readonly sfSymbol = input<string>();
  /** An image asset of the app's own. */
  readonly image = input<string>();
  readonly tooltip = input<string>();
  readonly press = output<void>();

  constructor() {
    const menu = inject(MENU_MODEL, { self: true });
    const stop = inject(Tray).add(
      computed(() => ({
        ...(this.title() && { title: this.title() }),
        ...(this.sfSymbol() && { sfSymbol: this.sfSymbol() }),
        ...(this.image() && { image: this.image() }),
        ...(this.tooltip() && { tooltip: this.tooltip() }),
        menu: menu.entries(),
        press: () => this.press.emit(),
      })),
    );
    inject(DestroyRef).onDestroy(stop);
  }
}
