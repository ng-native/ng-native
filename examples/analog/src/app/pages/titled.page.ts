import type { RouteMeta } from '@analogjs/router';
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { FeatureNote } from '../ui/feature-note.ts';

export const routeMeta: RouteMeta = { title: 'Titled by routeMeta' };

/** A page whose header title comes from its `routeMeta`. */
@Component({
  imports: [FeatureNote, NativeHeader, ScrollView, Text, View],
  template: `
    <native-header [title]="title" />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <app-feature-note
          file="src/app/pages/titled.page.ts"
          explanation="routeMeta is the page's route config. Its title is the route's title, which the page reads from ActivatedRoute and gives to the native header above."
        />
        <view class="card result-row">
          <text class="result-label">ROUTEMETA.TITLE</text>
          <text class="result">{{ title }}</text>
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: '../ui/page.css',
})
export default class TitledPage {
  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
}
