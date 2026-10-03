import type { RouteMeta } from '@analogjs/router';
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { FeatureNote } from '../ui/feature-note.ts';

export const routeMeta: RouteMeta = { title: 'About' };

/** A static page: one file, one URL, no parameters. */
@Component({
  imports: [FeatureNote, NativeHeader, ScrollView, Text, View],
  template: `
    <native-header [title]="title" />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <app-feature-note
          file="src/app/pages/about.page.ts"
          explanation="A file in pages/ is a page, and its path is its URL: about.page.ts is /about. Its default export is the component, pushed on the native stack."
        />
        <view class="card result-row">
          <text class="result-label">URL</text>
          <text class="result">/about</text>
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: '../ui/page.css',
})
export default class AboutPage {
  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
}
