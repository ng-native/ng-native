import { Component, signal } from '@angular/core';
import { Sidebar, SidebarItem, SidebarSection, SplitView, Text, View } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';

/**
 * A sidebar beside its content: the window's sidebar on macOS, two columns on an iPad and on
 * Android from Material's expanded width (840dp), and a stack whose root is the sidebar on a phone.
 */
@Component({
  selector: 'x-desktop-split',
  imports: [NativeHeader, Sidebar, SidebarItem, SidebarSection, SplitView, Text, View],
  template: `
    <native-header title="Split View" />
    <split-view testID="split">
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
}
