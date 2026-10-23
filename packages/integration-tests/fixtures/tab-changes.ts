import { Component, signal } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

/** A feature flag that turns the Beta tab on after the app has started. */
export const betaEnabled = signal(false);

@Component({
  selector: 'x-shell',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class Shell {}

@Component({
  selector: 'x-bar',
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    <native-tabs-outlet>
      <native-tab path="home" title="Home" />
      @if (betaEnabled()) {
        <native-tab path="beta" title="Beta" />
      }
    </native-tabs-outlet>
  `,
})
export class Bar {
  protected readonly betaEnabled = betaEnabled;
}

@Component({ selector: 'x-home', imports: [Text], template: `<text>home</text>` })
export class Home {}

@Component({ selector: 'x-beta', imports: [Text], template: `<text>beta</text>` })
export class Beta {}

export const routes: Routes = [
  {
    path: '',
    component: Bar,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', component: Home },
      { path: 'beta', component: Beta },
    ],
  },
];

export const promoEnabled = signal(true);

@Component({
  selector: 'x-promo-bar',
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    <native-tabs-outlet>
      @if (promoEnabled()) {
        <native-tab path="promo" title="Promo" />
      }
      <native-tab path="home" title="Home" />
      <native-tab path="library" title="Library" />
    </native-tabs-outlet>
  `,
})
export class PromoBar {
  protected readonly promoEnabled = promoEnabled;
}

@Component({ selector: 'x-promo', imports: [Text], template: `<text>promo</text>` })
export class Promo {}

@Component({ selector: 'x-library', imports: [Text], template: `<text>library</text>` })
export class Library {}

export const promoRoutes: Routes = [
  {
    path: '',
    component: PromoBar,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'promo', component: Promo },
      { path: 'home', component: Home },
      { path: 'library', component: Library },
    ],
  },
];
