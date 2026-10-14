import { Component, DestroyRef, inject, type Signal } from '@angular/core';
import { ActivatedRoute, type Routes } from '@angular/router';
import { SCREEN_IN_FRONT } from '@ng-native/device';
import { Text } from '../../components/src/text.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

/** Every page alive, with what it was told about being in front, for the test to read. */
export interface LivePage {
  readonly name: () => string;
  readonly inFront: Signal<boolean>;
}
export const live = new Set<LivePage>();

/** Record the page under `kind`, with its route's id when it has one, until it is destroyed. */
// The id is read when asked: a page kept for another id of its route is that page.
function record(kind: string): void {
  const route = inject(ActivatedRoute);
  const name = () => {
    const id = route.snapshot.paramMap.get('id');
    return id ? `${kind}/${id}` : kind;
  };
  const page = { name, inFront: inject(SCREEN_IN_FRONT) };
  live.add(page);
  inject(DestroyRef).onDestroy(() => live.delete(page));
}

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
      <native-tab path="library" title="Library" />
    </native-tabs-outlet>
  `,
})
export class Bar {}

@Component({
  selector: 'x-tab-stack',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class TabStack {}

@Component({ selector: 'x-home', imports: [Text], template: `<text>home</text>` })
export class Home {
  constructor() {
    record('home');
  }
}

@Component({ selector: 'x-library', imports: [Text], template: `<text>library</text>` })
export class Library {
  constructor() {
    record('library');
  }
}

@Component({ selector: 'x-album', imports: [Text], template: `<text>album</text>` })
export class Album {
  constructor() {
    record('library');
  }
}

@Component({ selector: 'x-detail', imports: [Text], template: `<text>detail</text>` })
export class Detail {
  constructor() {
    record('detail');
  }
}

export const routes: Routes = [
  {
    path: '',
    component: Bar,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', component: Home },
      {
        path: 'library',
        component: TabStack,
        children: [
          { path: '', component: Library },
          { path: ':id', component: Album },
        ],
      },
    ],
  },
  { path: 'detail/:id', component: Detail },
];
