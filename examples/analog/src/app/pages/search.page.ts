import type { RouteMeta } from '@analogjs/router';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader, NativeRouterLink } from '@ng-native/router';
import { FeatureNote } from '../ui/feature-note.ts';

export const routeMeta: RouteMeta = { title: 'Search' };

/** A page reading its query string. */
@Component({
  imports: [FeatureNote, NativeHeader, NativeRouterLink, Pressable, ScrollView, Text, View],
  template: `
    <native-header [title]="title" />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <app-feature-note
          file="src/app/pages/search.page.ts"
          explanation="Query parameters are not part of the file's path. The page reads ?q= from ActivatedRoute, and follows it as it changes."
        />
        <view class="card result-row">
          <text class="result-label">Q</text>
          <text class="result">{{ query() }}</text>
        </view>
        <text class="section">SEARCH FOR</text>
        <view class="card">
          @for (term of terms; track term; let first = $first) {
            <pressable
              accessibilityRole="button"
              [accessibilityLabel]="'Search for ' + term"
              class="row"
              [class.row-divider]="!first"
              nativeRouterLink="/search"
              [extras]="{ queryParams: { q: term } }"
            >
              <text class="link row-body">?q={{ term }}</text>
              <text class="chevron">›</text>
            </pressable>
          }
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: '../ui/page.css',
})
export default class SearchPage {
  private readonly route = inject(ActivatedRoute);

  protected readonly title = this.route.snapshot.title ?? '';
  protected readonly query = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('q') ?? '')),
    { initialValue: '' },
  );
  protected readonly terms = ['native', 'layouts'];
}
