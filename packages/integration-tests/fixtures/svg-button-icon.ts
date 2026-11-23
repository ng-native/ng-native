import { Component, signal } from '@angular/core';
import { NativeButton, type ButtonIcon } from '../../components/src/native-button.ts';
import { Sidebar } from '../../components/src/sidebar.ts';
import { SidebarItem } from '../../components/src/sidebar-item.ts';
import { SidebarSection } from '../../components/src/sidebar-section.ts';
import { SplitView } from '../../components/src/split-view.ts';
import { View } from '../../components/src/view.ts';

/** Lucide's `blocks`, as `@ng-icons/lucide` exports it. */
export const blocks =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect width="7" height="7" x="14" y="3" rx="1" /><path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 ' +
  '1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3" /></svg>';

@Component({
  selector: 'x-svg-button-icon',
  imports: [NativeButton, Sidebar, SidebarItem, SidebarSection, SplitView, View],
  template: `
    <split-view>
      <sidebar>
        <sidebar-section>
          <sidebar-item testID="skills" label="Skills" [icon]="icon()" />
        </sidebar-section>
      </sidebar>
      <view />
    </split-view>
    <native-button testID="add" [icon]="icon()">Add</native-button>
  `,
})
export class SvgButtonIconFixture {
  readonly icon = signal<ButtonIcon>({ svg: blocks });
}
