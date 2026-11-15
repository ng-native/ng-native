import { Component } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

@Component({
  selector: 'x-macos-tabs',
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    <native-tabs-outlet>
      <native-tab path="library" title="Library" sfSymbol="books.vertical" badge="3" />
      <native-tab path="search" title="Search" drawable="ic_search" />
    </native-tabs-outlet>
  `,
})
export class Bar {}

@Component({ selector: 'x-page', imports: [Text], template: '<text>page</text>' })
class Page {}

export const routes: Routes = [
  { path: 'library', component: Page },
  { path: 'search', component: Page },
  { path: '', pathMatch: 'full', redirectTo: 'library' },
];
