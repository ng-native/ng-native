import { Component, signal } from '@angular/core';
import { Pressable } from '../../components/src/pressable.ts';
import { Sidebar } from '../../components/src/sidebar.ts';
import { SidebarItem } from '../../components/src/sidebar-item.ts';
import { SidebarSection } from '../../components/src/sidebar-section.ts';
import { SplitView } from '../../components/src/split-view.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

@Component({
  selector: 'x-sidebar',
  imports: [Pressable, Sidebar, SidebarItem, SidebarSection, SplitView, Text, View],
  template: `
    <split-view testID="split">
      <sidebar
        testID="sidebar"
        [(collapsed)]="collapsed"
        minWidth="180"
        maxWidth="400"
        autosave="main"
      >
        <view testID="search" />
        <sidebar-section testID="mail" title="Mailboxes" collapsible>
          <sidebar-item
            testID="inbox"
            label="Inbox"
            sfSymbol="tray"
            [badge]="unread()"
            [(selected)]="inbox"
            (select)="chosen.set('inbox')"
          />
          <sidebar-item
            testID="sent"
            label="Sent"
            [icon]="{ sfSymbol: 'paperplane' }"
            [(selected)]="sent"
            (select)="chosen.set('sent')"
          />
        </sidebar-section>
        <sidebar-section testID="smart">
          <sidebar-item testID="storage" label="Storage" (select)="chosen.set('storage')">
            <pressable testID="bump" (press)="bumps.set(bumps() + 1)"><text>+</text></pressable>
          </sidebar-item>
        </sidebar-section>
      </sidebar>
      <view testID="content"
        ><text>{{ chosen() }}</text></view
      >
    </split-view>
  `,
})
export class SidebarFixture {
  readonly collapsed = signal(false);
  readonly inbox = signal(true);
  readonly sent = signal(false);
  readonly unread = signal(3);
  readonly chosen = signal('');
  readonly bumps = signal(0);
}
