import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectMarkdownPage } from '@ng-native/analog';
import { ScrollView, View } from '@ng-native/components';
import { Markdown, type MarkdownLinkPress } from '@ng-native/components/markdown';
import { NativeHeader, NativeNavigation } from '@ng-native/router';
import { FeatureNote } from './feature-note.ts';
import { followMarkdownLink } from './markdown-link.ts';

/**
 * What a `.md` page in `pages/` is drawn with: `pageRoutes(pages, { markdownPage: MarkdownPage })`.
 * Its file, front matter and tokens come from `injectMarkdownPage()`.
 */
@Component({
  imports: [FeatureNote, Markdown, NativeHeader, ScrollView, View],
  template: `
    <native-header [title]="title" />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <app-feature-note
          [file]="file"
          explanation="A .md file in pages/ is a page, as in Analog. pageRoutes routes it to the app's markdownPage component, which draws its tokens with <markdown>; its front matter title is the route's title."
        />
        <view class="card document">
          <markdown [tokens]="page.tokens" (linkPress)="follow($event)" />
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: './page.css',
  styles: `
    .document {
      padding: 16px;
    }
  `,
})
export class MarkdownPage {
  private readonly navigation = inject(NativeNavigation);

  protected readonly page = injectMarkdownPage<{ title?: string }>();
  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
  protected readonly file = this.page.filename.replace(/^\//, '');

  protected follow(link: MarkdownLinkPress): void {
    followMarkdownLink(this.navigation, link);
  }
}
