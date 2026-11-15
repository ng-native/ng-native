import { Component, signal } from '@angular/core';
import { ContextMenu } from '../../components/src/context-menu.ts';
import { MenuBar, MenuGroup, MenuItem, MenuSeparator } from '../../components/src/menu.ts';
import { Pressable } from '../../components/src/pressable.ts';
import { Shortcut } from '../../components/src/shortcut.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

@Component({
  selector: 'x-menus',
  imports: [
    ContextMenu,
    MenuBar,
    MenuGroup,
    MenuItem,
    MenuSeparator,
    Pressable,
    Shortcut,
    Text,
    View,
  ],
  template: `
    @if (showBar()) {
      <menu-bar>
        <menu-group label="Notes" menuRole="app">
          <menu-item menuRole="settings" label="Settings..." (select)="log('settings')" />
        </menu-group>
        <menu-group label="File" menuRole="file">
          <menu-item label="New" shortcut="mod+n" (select)="log('new')" />
          @if (showOpen()) {
            <menu-item label="Open" shortcut="mod+o" (select)="log('open')" />
          }
          <menu-separator />
          <menu-item label="Save" shortcut="mod+s" [disabled]="!dirty()" (select)="log('save')" />
        </menu-group>
        <menu-group label="Edit" menuRole="edit">
          <menu-item menuRole="copy" label="Copy Note" />
        </menu-group>
        <menu-group label="Format">
          <menu-item label="Wrap Lines" [(checked)]="wrap" />
        </menu-group>
      </menu-bar>
    }
    <view
      testID="search"
      shortcut="mod+k"
      shortcutLabel="Search"
      (shortcutPress)="log('search')"
    ></view>
    <view shortcut="mod+a" shortcutLabel="Select Every Note" (shortcutPress)="log('all')"></view>
    <pressable testID="row" [contextMenu]="rowMenu" (longPress)="log('long')">
      <text>Row</text>
    </pressable>
    <ng-template #rowMenu>
      <menu-item label="Rename" sfSymbol="pencil" icon="ic_edit" (select)="log('rename')" />
      <menu-item label="Delete" destructive (select)="log('delete')" />
    </ng-template>
  `,
})
export class MenusFixture {
  readonly showBar = signal(true);
  readonly showOpen = signal(false);
  readonly dirty = signal(false);
  readonly wrap = signal(false);
  readonly said: string[] = [];

  log(what: string): void {
    this.said.push(what);
  }
}
