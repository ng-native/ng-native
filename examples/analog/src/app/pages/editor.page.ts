import type { RouteMeta } from '@analogjs/router';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ScrollView, Text, TextInput, View } from '@ng-native/components';
import { Markdown, type MarkdownLinkPress } from '@ng-native/components/markdown';
import { NativeHeader, NativeNavigation } from '@ng-native/router';
import { FeatureNote } from '../ui/feature-note.ts';
import { followMarkdownLink } from '../ui/markdown-link.ts';

export const routeMeta: RouteMeta = { title: 'Markdown editor' };

const STARTER = `## Try it

Type **Markdown** here and the preview follows: _emphasis_, \`code\`, lists and
[a link to the blog](/blog).

- one
- two
`;

/** A document typed on the device, parsed by marked as it changes, through `[source]`. */
@Component({
  imports: [FeatureNote, Markdown, NativeHeader, ScrollView, Text, TextInput, View],
  template: `
    <native-header [title]="title" />
    <scroll-view
      class="scroll"
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
    >
      <view class="content">
        <app-feature-note
          file="src/app/pages/editor.page.ts"
          explanation="What is typed is parsed on the device as it changes, and drawn by <markdown [source]> as native text and views."
        />
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

    .document {
      padding: 16px;
    }
  `,
})
export default class EditorPage {
  private readonly navigation = inject(NativeNavigation);

  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
  protected readonly draft = signal(STARTER);

  protected follow(link: MarkdownLinkPress): void {
    followMarkdownLink(this.navigation, link);
  }
}
