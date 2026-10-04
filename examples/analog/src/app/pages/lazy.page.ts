import type { RouteMeta } from '@analogjs/router';
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { FeatureNote } from '../ui/feature-note.ts';

export const routeMeta: RouteMeta = { title: 'Lazy loading' };

/** Every page, this one included, is loaded the first time it is opened. */
@Component({
  imports: [FeatureNote, NativeHeader, ScrollView, Text, View],
  template: `
    <native-header [title]="title" />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <app-feature-note
          file="src/app/pages/lazy.page.ts"
          explanation="The pages are found with require.context(..., 'lazy'), so a page's code runs the first time it is opened, as Analog loads a page on the web. Metro's dev server and a web export serve each page as a file of its own; a native release export keeps them all in its one bundle."
        />
        <view class="card result-row">
          <text class="result-label">LOADED</text>
          <text class="result">On first open</text>
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: '../ui/page.css',
})
export default class LazyPage {
  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
}
