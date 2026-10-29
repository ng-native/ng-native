import { Component, signal } from '@angular/core';
import type { Routes } from '@angular/router';
import { RefreshControl } from '../../components/src/refresh-control.ts';
import { ScrollView } from '../../components/src/scroll-view.ts';
import { Text } from '../../components/src/text.ts';
import { NativeHeader } from '../../router/src/native-header.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

/** Whether each page is loading. Every one starts out loading, as a page showing cached data. */
export const loading = {
  home: signal(true),
  library: signal(true),
  detail: signal(true),
  plain: signal(true),
};

/** Whether the bar has the library tab, for a test to take it away and bring it back. */
export const libraryTab = signal(true);

@Component({
  selector: 'x-shell',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class Shell {}

@Component({
  selector: 'x-tabs',
  imports: [NativeHeader, NativeTab, NativeTabsOutlet],
  template: `
    <native-header [hidden]="true" />
    <native-tabs-outlet>
      <native-tab path="home" title="Home" />
      @if (libraryTab()) {
        <native-tab path="library" title="Library" />
      }
    </native-tabs-outlet>
  `,
})
export class Tabs {
  protected readonly libraryTab = libraryTab;
}

@Component({
  selector: 'x-home-stack',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class HomeStack {}

/** Pages under a large title whose list is refreshing as they mount. */
@Component({
  selector: 'x-home',
  imports: [NativeHeader, RefreshControl, ScrollView, Text],
  template: `
    <native-header title="Home" [largeTitle]="true" />
    <scroll-view contentInsetAdjustmentBehavior="automatic">
      <refresh-control nativeID="home" [refreshing]="loading()" />
      <text>first row</text>
    </scroll-view>
  `,
})
export class Home {
  protected readonly loading = loading.home;
}

@Component({
  selector: 'x-library',
  imports: [NativeHeader, RefreshControl, ScrollView, Text],
  template: `
    <native-header title="Library" [largeTitle]="true" />
    <scroll-view contentInsetAdjustmentBehavior="automatic">
      <refresh-control nativeID="library" [refreshing]="loading()" />
      <text>first row</text>
    </scroll-view>
  `,
})
export class Library {
  protected readonly loading = loading.library;
}

@Component({
  selector: 'x-detail',
  imports: [NativeHeader, RefreshControl, ScrollView, Text],
  template: `
    <native-header title="Detail" [largeTitle]="true" />
    <scroll-view contentInsetAdjustmentBehavior="automatic">
      <refresh-control nativeID="detail" [refreshing]="loading()" />
      <text>first row</text>
    </scroll-view>
  `,
})
export class Detail {
  protected readonly loading = loading.detail;
}

/** The same control on a view that no outlet shows. */
@Component({
  selector: 'x-plain',
  imports: [RefreshControl, ScrollView, Text],
  template: `
    <scroll-view>
      <refresh-control nativeID="plain" [refreshing]="loading()" />
      <text>first row</text>
    </scroll-view>
  `,
})
export class Plain {
  protected readonly loading = loading.plain;
}

export const routes: Routes = [
  {
    path: '',
    component: Tabs,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', component: HomeStack, children: [{ path: '', component: Home }] },
      { path: 'library', component: Library },
    ],
  },
  { path: 'detail', component: Detail },
];
