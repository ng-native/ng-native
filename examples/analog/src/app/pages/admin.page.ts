import type { RouteMeta } from '@analogjs/router';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, type CanActivateFn } from '@angular/router';
import { ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { AdminAccess } from '../data/admin-access.ts';
import { FeatureNote } from '../ui/feature-note.ts';

/** In only while Admin access is on, in Settings. */
const adminAccess: CanActivateFn = () => inject(AdminAccess).granted();

export const routeMeta: RouteMeta = {
  title: 'Admin',
  canActivate: [adminAccess],
};

/** A page a guard in its `routeMeta` keeps closed until a setting opens it. */
@Component({
  imports: [FeatureNote, NativeHeader, ScrollView, Text, View],
  template: `
    <native-header [title]="title" />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <app-feature-note
          file="src/app/pages/admin.page.ts"
          explanation="routeMeta.canActivate guards the page. The guard reads a signal that Admin access in Settings sets, so with it off, the navigation here is refused."
        />
        <view class="card result-row">
          <text class="result-label">GUARD</text>
          <text class="result">Let in</text>
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: '../ui/page.css',
})
export default class AdminPage {
  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
}
