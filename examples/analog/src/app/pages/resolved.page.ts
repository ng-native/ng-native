import type { RouteMeta } from '@analogjs/router';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, type ResolveFn } from '@angular/router';
import { ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { FeatureNote } from '../ui/feature-note.ts';

/** What the resolver loads before the page is shown. */
export interface Release {
  readonly version: string;
  readonly notes: readonly string[];
}

/** Stands in for a request: the page waits for it before it is pushed. */
const release: ResolveFn<Release> = () =>
  new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          version: '2.8.0',
          notes: ['Pages from require.context', 'Layouts on a native stack', 'routeMeta guards'],
        }),
      300,
    ),
  );

export const routeMeta: RouteMeta = {
  title: 'Resolver',
  resolve: { release },
};

/** A page whose data a resolver in its `routeMeta` loads first. */
@Component({
  imports: [FeatureNote, NativeHeader, ScrollView, Text, View],
  template: `
    <native-header [title]="title" />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <app-feature-note
          file="src/app/pages/resolved.page.ts"
          explanation="routeMeta.resolve loads the release below before the page is shown, so it is there on the first frame, with no loading state."
        />
        <view class="card result-row">
          <text class="result-label">RESOLVED RELEASE</text>
          <text class="result">{{ release.version }}</text>
        </view>
        <view class="card">
          @for (note of release.notes; track note; let first = $first) {
            <view class="row" [class.row-divider]="!first">
              <text class="row-title row-body">{{ note }}</text>
            </view>
          }
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: '../ui/page.css',
})
export default class ResolvedPage {
  private readonly route = inject(ActivatedRoute);

  protected readonly title = this.route.snapshot.title ?? '';
  protected readonly release = this.route.snapshot.data['release'] as Release;
}
