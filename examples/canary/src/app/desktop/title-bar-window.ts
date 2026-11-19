import { Component, inject } from '@angular/core';
import { SafeAreaProvider, Text, View } from '@ng-native/components';
import { SafeArea } from '@ng-native/device';

/**
 * A window whose content runs under a transparent title bar. Its top row fills the title bar's
 * strip, padded clear of the window controls by the title-bar insets, so its two labels sit beside
 * the controls on whichever side the OS puts them.
 */
@Component({
  selector: 'x-title-bar-window',
  imports: [SafeAreaProvider, Text, View],
  template: `
    <safe-area-provider>
      <view class="title-bar-window">
        <view class="title-bar-strip">
          <text class="title-bar-chip">{{ area.titlebarLeading() }}</text>
          <text class="title-bar-chip">{{ area.titlebarTrailing() }}</text>
        </view>
        <text class="body">
          The content runs under the title bar. The blue strip is the title bar's height, and its
          labels say how far the window controls reach in from each side.
        </text>
      </view>
    </safe-area-provider>
  `,
  styles: `
    .title-bar-window {
      flex: 1;
      background-color: #eef3ff;
      gap: 12px;
    }
    .title-bar-strip {
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      background-color: #c9dbff;
      height: var(--safe-area-inset-top);
      padding-inline-start: var(--safe-area-inset-titlebar-leading);
      padding-inline-end: var(--safe-area-inset-titlebar-trailing);
    }
    .title-bar-chip {
      font-size: 12px;
      font-weight: 600;
      color: #1d4ed8;
      padding: 2px 8px;
    }
    .body {
      font-size: 14px;
      padding: 0 16px;
    }
  `,
})
export class TitleBarWindow {
  protected readonly area = inject(SafeArea);
}
