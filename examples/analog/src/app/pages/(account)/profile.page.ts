import type { RouteMeta } from '@analogjs/router';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader, NativeRouterLink } from '@ng-native/router';
import { FeatureNote } from '../../ui/feature-note.ts';

export const routeMeta: RouteMeta = { title: 'Profile' };

/** A page in a route group, whose name is in no URL. */
@Component({
  imports: [FeatureNote, NativeHeader, NativeRouterLink, Pressable, ScrollView, Text, View],
  template: `
    <native-header [title]="title" />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <app-feature-note
          file="src/app/pages/(account)/profile.page.ts"
          explanation="A folder in parentheses is a group: it keeps related pages together and adds nothing to the URL."
        />
        <view class="card result-row">
          <text class="result-label">URL</text>
          <text class="result">{{ url }}</text>
        </view>
        <view class="card">
          <pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            class="row"
            nativeRouterLink="/settings"
          >
            <view class="row-body">
              <text class="row-title">Settings</text>
              <text class="row-sub">(account)/settings.page.ts, at /settings</text>
            </view>
            <text class="chevron">›</text>
          </pressable>
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: '../../ui/page.css',
})
export default class ProfilePage {
  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
  protected readonly url = inject(Router).url;
}
