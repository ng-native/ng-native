/**
 * A page bound to two route resources, one blocking and one not, shown on a native stack, in a
 * native tab and under Angular's own RouterOutlet, so the three can be compared.
 */
import { Component, input, resource, type Resource, type Signal } from '@angular/core';
import { RouterOutlet, nonBlocking, type Params, type Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

/** Every page made, newest last, so a test can read its inputs between two commits. */
export const pages: Page[] = [];

@Component({
  selector: 'x-resource-page',
  imports: [Text],
  template: `<text
    >page id={{ id() }} user={{ user() }} feed={{ feed()?.value() }} q={{ q() }}</text
  >`,
})
export class Page {
  readonly id = input<string>();
  /** A blocking resource: the router waits for it, and the input gets its value. */
  readonly user = input<string>();
  /** A non-blocking one: the input gets the resource itself. */
  readonly feed = input<Resource<string | undefined>>();
  readonly q = input<string>();

  constructor() {
    pages.push(this);
  }
}

@Component({ selector: 'x-resource-home', imports: [Text], template: `<text>home</text>` })
export class Home {}

const resources = ({ params }: { params: Signal<Params> }) => ({
  user: resource({
    params: () => String(params()['id'] ?? 'tab'),
    loader: async ({ params: id }) => 'user ' + id,
  }),
  feed: nonBlocking(
    resource({
      params: () => String(params()['id'] ?? 'tab'),
      loader: async ({ params: id }) => 'feed ' + id,
    }),
  ),
});

@Component({
  selector: 'x-resource-stack',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class StackShell {}

@Component({
  selector: 'x-resource-router-outlet',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class AngularShell {}

@Component({
  selector: 'x-resource-tabs',
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    <native-tabs-outlet>
      <native-tab path="home" title="Home" />
      <native-tab path="page" title="Page" />
    </native-tabs-outlet>
  `,
})
export class TabsShell {}

export const stackRoutes: Routes = [
  { path: '', component: Home },
  { path: 'page/:id', component: Page, resources },
];

export const tabRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', component: Home },
  { path: 'page', component: Page, resources },
];
