import type { RouteMeta } from '@analogjs/router';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { injectContent } from '@ng-native/analog';
import { ScrollView, Text, View } from '@ng-native/components';
import { Markdown, type MarkdownLinkPress } from '@ng-native/components/markdown';
import { NativeHeader, NativeNavigation } from '@ng-native/router';
import { postDate, type PostAttributes } from '../../data/post.ts';
import { FeatureNote } from '../../ui/feature-note.ts';
import { followMarkdownLink } from '../../ui/markdown-link.ts';

export const routeMeta: RouteMeta = { title: 'Post' };

/** One post, found by the `slug` parameter with `injectContent`, and drawn with `<markdown>`. */
@Component({
  imports: [FeatureNote, Markdown, NativeHeader, ScrollView, Text, View],
  template: `
    <native-header [title]="post()?.attributes?.title ?? 'Post'" />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <app-feature-note
          file="src/app/pages/blog/[slug].page.ts"
          explanation="injectContent() reads the slug parameter and finds src/content/<slug>.md, as in Analog. <markdown [tokens]> draws the tokens Metro lexed, so nothing is parsed here."
        />
        @if (post(); as post) {
          <view class="card document">
            @if (byline(); as byline) {
              <text class="row-sub">{{ byline }}</text>
            }
            <markdown [tokens]="post.tokens" [source]="post.content" (linkPress)="follow($event)" />
          </view>
        }
      </view>
    </scroll-view>
  `,
  styleUrl: '../../ui/page.css',
  styles: `
    .document {
      padding: 16px;
      gap: 12px;
    }
  `,
})
export default class PostPage {
  private readonly navigation = inject(NativeNavigation);

  protected readonly post = toSignal(injectContent<PostAttributes>());
  protected readonly byline = computed(() => {
    const attributes = this.post()?.attributes;
    return attributes?.date ? `${attributes.author} · ${postDate(attributes.date)}` : '';
  });

  protected follow(link: MarkdownLinkPress): void {
    followMarkdownLink(this.navigation, link);
  }
}
