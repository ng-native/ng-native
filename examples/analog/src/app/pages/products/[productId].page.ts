import type { RouteMeta } from '@analogjs/router';
import { Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader, NativeHeaderItem, NativeNavigation } from '@ng-native/router';
import { productById } from '../../data/products.ts';
import { FeatureNote } from '../../ui/feature-note.ts';

export const routeMeta: RouteMeta = { title: 'Product' };

/** A dynamic parameter: the `[productId]` in the file name is a segment of the URL. */
@Component({
  imports: [FeatureNote, NativeHeader, NativeHeaderItem, Pressable, ScrollView, Text, View],
  template: `
    <native-header [title]="title">
      <native-header-item type="right">
        <pressable accessibilityRole="button" (press)="close()">
          <text class="bar-button">Done</text>
        </pressable>
      </native-header-item>
    </native-header>
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <app-feature-note
          file="src/app/pages/products/[productId].page.ts"
          explanation="[productId] in the file name is a route parameter. It reaches the page as an input, through withComponentInputBinding()."
        />
        <view class="card result-row">
          <text class="result-label">productId</text>
          <text class="result">{{ productId() }}</text>
        </view>
        @if (product(); as product) {
          <view class="card row">
            <text class="row-title row-body">{{ product.name }}</text>
            <text class="row-sub">{{ product.price }}</text>
          </view>
        }
      </view>
    </scroll-view>
  `,
  styleUrl: '../../ui/page.css',
})
export default class ProductPage {
  private readonly navigation = inject(NativeNavigation);

  readonly productId = input.required<string>();

  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
  protected readonly product = computed(() => productById(this.productId()));

  /** Back to the first page of the sheet, then out of the sheet. */
  protected async close(): Promise<void> {
    await this.navigation.popToRoot();
    this.navigation.back();
  }
}
