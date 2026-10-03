import type { RouteMeta } from '@analogjs/router';
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader, NativeRouterLink } from '@ng-native/router';
import { FeatureNote } from '../../ui/feature-note.ts';

export const routeMeta: RouteMeta = { title: 'Docs' };

/** The other paths this page links to, each caught by the same file. */
const PATHS = ['/docs/routing', '/docs/guides/layouts/nested'];

/** A catch-all: every URL under /docs, however many segments deep. */
@Component({
  imports: [FeatureNote, NativeHeader, NativeRouterLink, Pressable, ScrollView, Text, View],
  template: `
    <native-header [title]="title" />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <app-feature-note
          file="src/app/pages/docs/[...slug].page.ts"
          explanation="[...slug] catches the rest of the URL after /docs, one segment or many, in one page."
        />
        <view class="card result-row">
          <text class="result-label">CAUGHT SEGMENTS</text>
          <view class="chips">
            @for (segment of segments; track $index) {
              <view class="chip">
                <text class="chip-text">{{ segment }}</text>
              </view>
            }
          </view>
        </view>
        <text class="section">TRY ANOTHER PATH</text>
        <view class="card">
          @for (path of paths; track path; let first = $first) {
            <pressable
              accessibilityRole="button"
              [accessibilityLabel]="path"
              class="row"
              [class.row-divider]="!first"
              [nativeRouterLink]="path"
            >
              <text class="link row-body">{{ path }}</text>
              <text class="chevron">›</text>
            </pressable>
          }
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: '../../ui/page.css',
})
export default class DocsPage {
  private readonly route = inject(ActivatedRoute);

  protected readonly title = this.route.snapshot.title ?? '';
  /** Every segment of the URL after `docs`, which the catch-all route consumed. */
  protected readonly segments = this.route.snapshot.pathFromRoot
    .flatMap((snapshot) => snapshot.url.map((segment) => segment.path))
    .slice(1);
  protected readonly paths = PATHS;
}
