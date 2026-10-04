import { Component, inject, signal } from '@angular/core';
import { ScrollView, Text, TextInput, View } from '@ng-native/components';
import { Markdown, type MarkdownLinkPress } from '@ng-native/components/markdown';
import { NativeHeader, NativeNavigation } from '@ng-native/router';
import { followLink } from '../ui/follow-link.ts';

const STARTER = `## Try it

Type **Markdown** here and the preview follows: _emphasis_, \`code\`, lists and
[links](/notes/welcome).

- one
- two
`;

/** A document typed on the device, parsed by `marked` as it changes, through `[source]`. */
@Component({
  imports: [Markdown, NativeHeader, ScrollView, Text, TextInput, View],
  template: `
    <native-header title="Live editor" />
    <scroll-view
      class="scroll"
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
    >
      <view class="content">
        <text class="section">MARKDOWN</text>
        <view class="card">
          <text-input
            class="source"
            multiline
            autoCapitalize="none"
            autoCorrect="false"
            accessibilityLabel="Markdown source"
            [(value)]="draft"
          />
        </view>
        <text class="section">PREVIEW</text>
        <view class="card document">
          <markdown [source]="draft()" (linkPress)="follow($event)" />
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: '../ui/page.css',
  styles: `
    .source {
      min-height: 160px;
      padding: 12px 16px;
      color: light-dark(#1c1c1e, #ffffff);
      font-family: Menlo;
      font-size: 14px;
      line-height: 20px;
    }
  `,
})
export class Editor {
  private readonly navigation = inject(NativeNavigation);

  protected readonly draft = signal(STARTER);

  protected follow(link: MarkdownLinkPress): void {
    followLink(this.navigation, link);
  }
}
