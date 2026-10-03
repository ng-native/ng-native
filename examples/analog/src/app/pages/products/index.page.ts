import type { RouteMeta } from '@analogjs/router';
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import {
  NativeHeader,
  NativeHeaderItem,
  NativeNavigation,
  NativeRouterLink,
} from '@ng-native/router';
import { PRODUCTS } from '../../data/products.ts';
import { FeatureNote } from '../../ui/feature-note.ts';

export const routeMeta: RouteMeta = { title: 'Products' };

/** The first page of the products layout's stack. */
@Component({
  imports: [
    FeatureNote,
    NativeHeader,
    NativeHeaderItem,
    NativeRouterLink,
    Pressable,
    ScrollView,
    Text,
    View,
  ],
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
          file="src/app/pages/products/index.page.ts"
          explanation="products.page.ts is a layout: its native-stack-outlet holds every page in products/. This list is index.page.ts, and a product is pushed on the same stack, inside the sheet."
        />
        <view class="card">
          @for (product of products; track product.id; let first = $first) {
            <pressable
              accessibilityRole="button"
              [accessibilityLabel]="product.name"
              class="row"
              [class.row-divider]="!first"
              [nativeRouterLink]="['/products', product.id]"
            >
              <view class="row-body">
                <text class="row-title">{{ product.name }}</text>
                <text class="row-sub">/products/{{ product.id }}</text>
              </view>
              <text class="chevron">›</text>
            </pressable>
          }
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: '../../ui/page.css',
})
export default class ProductsPage {
  private readonly navigation = inject(NativeNavigation);

  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
  protected readonly products = PRODUCTS;

  protected close(): void {
    this.navigation.back();
  }
}
