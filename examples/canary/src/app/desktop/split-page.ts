import { Component, signal } from '@angular/core';
import {
  Pressable,
  Sidebar,
  SidebarItem,
  SidebarSection,
  SplitView,
  Text,
  View,
} from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';

/**
 * A sidebar beside its content: the window's sidebar on macOS, a UISplitViewController on an iPad,
 * two columns on Android from Material's expanded width (840dp), and a stack whose root is the
 * sidebar on a phone. The content pane can be drawn inset on macOS and Linux, a rounded card on the
 * sidebar's backdrop.
 */
@Component({
  selector: 'x-desktop-split',
  imports: [NativeHeader, Pressable, Sidebar, SidebarItem, SidebarSection, SplitView, Text, View],
  template: `
    <native-header title="Split View" />
    <split-view testID="split" [contentStyle]="inset() ? 'inset' : 'plain'">
      <sidebar testID="split-sidebar">
        <sidebar-section title="Mailboxes">
          @for (box of boxes; track box) {
            <sidebar-item
              [testID]="'box-' + box"
              [label]="box"
              [selected]="chosen() === box"
              (select)="chosen.set(box)"
            />
          }
        </sidebar-section>
      </sidebar>
      <view class="split-detail" testID="split-content">
        <text class="heading">{{ chosen() }}</text>
        <text class="hint">The content pane.</text>
        <pressable testID="split-inset" (press)="toggleInset()">
          <text>{{ inset() ? 'Plain content' : 'Inset content' }}</text>
        </pressable>
      </view>
    </split-view>
  `,
  styles: `
    .split-detail {
      flex: 1;
      padding: 16px;
      gap: 8px;
    }
  `,
})
export class SplitPage {
  protected readonly boxes = ['Inbox', 'Sent', 'Drafts', 'Archive'];
  protected readonly chosen = signal('Inbox');
  protected readonly inset = signal(false);

  protected toggleInset(): void {
    this.inset.update((inset) => !inset);
  }
}
