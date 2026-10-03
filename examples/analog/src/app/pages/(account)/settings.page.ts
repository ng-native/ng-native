import type { RouteMeta } from '@analogjs/router';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ScrollView, Switch, Text, View } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { AdminAccess } from '../../data/admin-access.ts';
import { FeatureNote } from '../../ui/feature-note.ts';

export const routeMeta: RouteMeta = { title: 'Settings' };

/** The group's second page, and the switch the admin page's guard reads. */
@Component({
  imports: [FeatureNote, NativeHeader, ScrollView, Switch, Text, View],
  template: `
    <native-header [title]="title" />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <app-feature-note
          file="src/app/pages/(account)/settings.page.ts"
          explanation="Another page of the (account) group, at a URL without the group in it."
        />
        <view class="card result-row">
          <text class="result-label">URL</text>
          <text class="result">{{ url }}</text>
        </view>
        <view class="card row">
          <view class="row-body">
            <text class="row-title">Admin access</text>
            <text class="row-sub">What the guard on admin.page.ts reads</text>
          </view>
          <switch
            accessibilityLabel="Admin access"
            [checked]="access.granted()"
            (checkedChange)="access.granted.set($event)"
          />
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: '../../ui/page.css',
})
export default class SettingsPage {
  protected readonly access = inject(AdminAccess);
  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
  protected readonly url = inject(Router).url;
}
