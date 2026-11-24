import { Component, signal } from '@angular/core';
import { ContextMenu } from '../../components/src/context-menu.ts';
import { MenuGroup, MenuItem } from '../../components/src/menu.ts';
import type { ButtonIcon } from '../../components/src/native-button.ts';
import { TrayIcon } from '../../components/src/tray-icon.ts';
import { View } from '../../components/src/view.ts';
import { NativeHeader } from '../../router/src/native-header.ts';
import { NativeHeaderItem } from '../../router/src/native-header-item.ts';

/** Lucide's `pencil`, as `@ng-icons/lucide` exports it. */
export const pencil =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2"><path d="M21 3 3 21" /></svg>';

/** An icon's SVG markup on every surface besides a button and a row: header, menus and tray. */
@Component({
  selector: 'x-svg-icon-surfaces',
  imports: [ContextMenu, MenuGroup, MenuItem, NativeHeader, NativeHeaderItem, TrayIcon, View],
  template: `
    <native-header title="Notes">
      <native-header-item type="right" accessibilityLabel="Edit" [icon]="icon()" [menu]="menu" />
      <native-header-item type="left" accessibilityLabel="Share" [icon]="icon()" />
    </native-header>
    <view testID="note" [contextMenu]="menu" />
    <tray-icon tooltip="Notes" [icon]="icon()">
      <menu-item label="Rename" [icon]="icon()" (select)="said.push('rename')" />
    </tray-icon>
    <ng-template #menu>
      <menu-item label="Rename" [icon]="icon()" (select)="said.push('rename')" />
      <menu-item label="Archive" icon="ic_archive" (select)="said.push('archive')" />
      <menu-group label="Move" [icon]="icon()">
        <menu-item label="Inbox" (select)="said.push('inbox')" />
      </menu-group>
      <menu-item label="Star" sfSymbol="star" [icon]="icon()" (select)="said.push('star')" />
    </ng-template>
  `,
})
export class SvgIconSurfacesFixture {
  readonly icon = signal<ButtonIcon>({ svg: pencil });
  readonly said: string[] = [];
}
