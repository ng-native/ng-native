import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ScrollView, View } from '@ng-native/components';
import { Markdown, type MarkdownLinkPress } from '@ng-native/components/markdown';
import { NativeHeader, NativeNavigation, injectMarkdownPage } from '@ng-native/router';
import { followLink } from './follow-link.ts';

/**
 * What a `.md` file in `pages/` is drawn with: `fileRoutes(pages, { markdownPage: MarkdownPage })`.
 * Its tokens come from `injectMarkdownPage()`, and its front matter `title` is the route's title.
 */
@Component({
  imports: [Markdown, NativeHeader, ScrollView, View],
  template: `
    <native-header [title]="title" />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <view class="card document">
          <markdown [tokens]="page.tokens" (linkPress)="follow($event)" />
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: './page.css',
})
export class MarkdownPage {
  private readonly navigation = inject(NativeNavigation);

  protected readonly page = injectMarkdownPage();
  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';

  protected follow(link: MarkdownLinkPress): void {
    followLink(this.navigation, link);
  }
}
