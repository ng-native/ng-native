import type { RouteMeta } from '@analogjs/router';
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectContentFiles } from '@ng-native/analog';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader, NativeRouterLink } from '@ng-native/router';
import { postDate, type PostAttributes } from '../../data/post.ts';
import { FeatureNote } from '../../ui/feature-note.ts';

export const routeMeta: RouteMeta = { title: 'Blog' };

/** Every post in `src/content`, newest first, from `injectContentFiles`. */
@Component({
  imports: [FeatureNote, NativeHeader, NativeRouterLink, Pressable, ScrollView, Text, View],
  template: `
    <native-header [title]="title" />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <app-feature-note
          file="src/app/pages/blog/index.page.ts"
          explanation="injectContentFiles() lists the .md files in src/content with their front matter, as @analogjs/content does. Metro parsed it as it bundled the app."
        />
        <view class="card">
          @for (post of posts; track post.slug; let first = $first) {
            <pressable
              accessibilityRole="button"
              [accessibilityLabel]="post.attributes.title"
              class="row"
              [class.row-divider]="!first"
              [nativeRouterLink]="['/blog', post.slug]"
            >
              <view class="row-body">
                <text class="row-title">{{ post.attributes.title }}</text>
                <text class="row-sub">{{ post.attributes.description }}</text>
                <text class="row-sub">{{ date(post.attributes.date) }}</text>
              </view>
              <text class="chevron">›</text>
            </pressable>
          }
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: '../../ui/page.css',
})
export default class BlogPage {
  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
  protected readonly posts = injectContentFiles<PostAttributes>().sort((a, b) =>
    b.attributes.date.localeCompare(a.attributes.date),
  );
  protected readonly date = postDate;
}
