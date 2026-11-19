import { Component } from '@angular/core';
import { MenuBar, MenuGroup, MenuItem } from '../../components/src/menu.ts';

/** A menu bar whose File group has no role, beside one of the app's own. */
@Component({
  selector: 'x-menus-unmerged',
  imports: [MenuBar, MenuGroup, MenuItem],
  template: `
    <menu-bar>
      <menu-group label="File">
        <menu-item label="New Issue" shortcut="mod+n" />
      </menu-group>
      <menu-group label="Issue">
        <menu-item label="Assign" />
      </menu-group>
    </menu-bar>
  `,
})
export class UnmergedMenus {}
