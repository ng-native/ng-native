import { Component, signal, viewChild } from '@angular/core';
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
    <split-view testID="split" [contentStyle]="contentStyle()">
      <sidebar
        testID="sidebar"
        [(collapsed)]="collapsed"
        minWidth="180"
        maxWidth="400"
        autosave="main"
      >
        <view testID="search" />
        <sidebar-section testID="mail" [title]="mailTitle()" [collapsible]="mailCollapsible()">
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
          <sidebar-item #storage testID="storage" label="Storage" (select)="chosen.set('storage')">
            <view>
              <pressable testID="bump" (press)="bumps.set(bumps() + 1)"><text>+</text></pressable>
              <text testID="storage-text" class="storage-text">Storage</text>
            </view>
          </sidebar-item>
        </sidebar-section>
      </sidebar>
      <view testID="content"
        ><text>{{ chosen() }}</text></view
      >
    </split-view>
  `,
  styles: `
    sidebar-item[data-selected] .storage-text {
      opacity: 0.8;
    }
    sidebar-item[data-emphasized] .storage-text {
      opacity: 0.5;
    }
  `,
})
export class SidebarFixture {
  readonly contentStyle = signal<'plain' | 'inset'>('inset');
  readonly collapsed = signal(false);
  readonly mailTitle = signal<string | undefined>('Mailboxes');
  readonly mailCollapsible = signal(true);
  readonly inbox = signal(true);
  readonly sent = signal(false);
  readonly unread = signal(3);
  readonly chosen = signal('');
  readonly bumps = signal(0);
  readonly split = viewChild.required(SplitView);
  readonly storage = viewChild.required('storage', { read: SidebarItem });
}

/** A split view that leaves its inputs at their defaults. */
@Component({
  selector: 'x-default-split',
  imports: [Sidebar, SplitView, View],
  template: `
    <split-view testID="split">
      <sidebar />
      <view testID="content" />
    </split-view>
  `,
})
export class DefaultSplitFixture {}
