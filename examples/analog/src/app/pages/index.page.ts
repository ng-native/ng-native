import type { RouteMeta } from '@analogjs/router';
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import { nativePlatform } from '@ng-native/fabric';
import { NgIcon } from '@ng-native/icons';
import { NativeHeader, NativeNavigation, type StackPresentation } from '@ng-native/router';
import { AdminAccess } from '../data/admin-access.ts';
import { ANALOG_LOGO } from '../ui/analog-logo.ts';

export const routeMeta: RouteMeta = { title: 'Analog Showroom' };

/** One row of the home page: a feature, the file that makes it, and where it is shown. */
interface Feature {
  readonly name: string;
  readonly file: string;
  readonly url: string;
  /** Opened as a sheet, with the stack its layout gives it, rather than pushed. */
  readonly sheet?: boolean;
}

interface Section {
  readonly title: string;
  readonly features: readonly Feature[];
}

const SECTIONS: readonly Section[] = [
  {
    title: 'PAGES',
    features: [
      { name: 'Static page', file: 'about.page.ts', url: '/about' },
      {
        name: 'Dynamic parameter',
        file: 'products/[productId].page.ts',
        url: '/products/tide-kettle',
        sheet: true,
      },
      { name: 'Nested layout', file: 'products.page.ts', url: '/products', sheet: true },
      {
        name: 'Catch-all',
        file: 'docs/[...slug].page.ts',
        url: '/docs/getting-started/install',
      },
      { name: 'Route group', file: '(account)/profile.page.ts', url: '/profile' },
      { name: 'Tabs', file: 'tabs.page.ts', url: '/tabs' },
    ],
  },
  {
    title: 'ROUTEMETA',
    features: [
      { name: 'Title', file: 'titled.page.ts', url: '/titled' },
      { name: 'Redirect', file: 'old-home.page.ts', url: '/old-home' },
      { name: 'Guard', file: 'admin.page.ts', url: '/admin' },
      { name: 'Resolver', file: 'resolved.page.ts', url: '/resolved' },
    ],
  },
  {
    title: 'LOADING',
    features: [
      { name: 'Lazy loading', file: 'lazy.page.ts', url: '/lazy' },
      { name: 'Query parameters', file: 'search.page.ts', url: '/search?q=signals' },
    ],
  },
  {
    title: 'CONTENT',
    features: [
      { name: 'Markdown', file: 'markdown.page.ts', url: '/markdown' },
      { name: 'Blog', file: 'blog/index.page.ts', url: '/blog' },
      { name: 'Markdown page', file: 'colophon.md', url: '/colophon' },
    ],
  },
];

/**
 * A form sheet on iOS. React Native Screens does not render a nested stack inside an Android form
 * sheet, and the products layout is one, so Android presents it as a modal.
 */
const sheet = (): StackPresentation => (nativePlatform() === 'android' ? 'modal' : 'formSheet');

/** The showroom's front door: the logo, and every feature with the file that makes it. */
@Component({
  imports: [NativeHeader, NgIcon, Pressable, ScrollView, Text, View],
  template: `
    <native-header [title]="title" />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <view class="card hero">
          <ng-icon [svg]="logo" [size]="112" accessibilityLabel="Analog" />
          <text class="hero-title">Analog Showroom</text>
          <text class="hero-sub"
            >Analog's file routes, running as native iOS and Android views</text
          >
        </view>
        @for (section of sections; track section.title) {
          <text class="section">{{ section.title }}</text>
          <view class="card">
            @for (feature of section.features; track feature.name; let first = $first) {
              <pressable
                accessibilityRole="button"
                [accessibilityLabel]="feature.name"
                class="row"
                [class.row-divider]="!first"
                (press)="open(feature)"
              >
                <view class="row-body">
                  <text class="row-title">{{ feature.name }}</text>
                  <text class="row-sub">{{ feature.file }}</text>
                </view>
                @if (feature.name === 'Guard') {
                  <view class="chip">
                    <text class="chip-text">{{ access.granted() ? 'Open' : 'Blocked' }}</text>
                  </view>
                }
                <text class="chevron">›</text>
              </pressable>
            }
          </view>
        }
      </view>
    </scroll-view>
  `,
  styleUrl: '../ui/page.css',
})
export default class HomePage {
  private readonly navigation = inject(NativeNavigation);

  protected readonly access = inject(AdminAccess);
  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
  protected readonly logo = ANALOG_LOGO;
  protected readonly sections = SECTIONS;

  protected open(feature: Feature): void {
    void (feature.sheet
      ? this.navigation.present(feature.url, { as: sheet() })
      : this.navigation.push(feature.url));
  }
}
