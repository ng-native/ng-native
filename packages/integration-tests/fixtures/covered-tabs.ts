import { Component } from '@angular/core';
import type { Routes } from '@angular/router';
import { Pressable } from '../../components/src/pressable.ts';
import { Text } from '../../components/src/text.ts';
import { TextInput } from '../../components/src/text-input.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';
import { Detail, Library, Search } from './tab-stacks.ts';

export { Shell } from './tab-stacks.ts';

/** The tab bar, each tab with an id a test can find its bar item by. */
@Component({
  selector: 'x-bar',
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    <native-tabs-outlet>
      <native-tab path="home" title="Home" nativeID="home-tab" />
      <native-tab path="library" title="Library" nativeID="library-tab" />
      <native-tab path="search" title="Search" nativeID="search-tab" />
    </native-tabs-outlet>
  `,
})
export class Bar {}

/** How many times the button on Home has been pressed. */
export const pressed = { count: 0 };

/** Home, with a button that counts its presses and a field that keeps what is typed. */
@Component({
  selector: 'x-home',
  imports: [Pressable, Text, TextInput],
  template: `
    <text>home</text>
    <pressable testID="count" (press)="count()"><text>count</text></pressable>
    <text-input testID="note" (changeText)="note($event)" />
  `,
})
export class Home {
  protected count(): void {
    pressed.count++;
  }

  protected note(text: string): void {
    typed.push(text);
  }
}

/** Each text the field on Home was changed to. */
export const typed: string[] = [];

export const routes: Routes = [
  {
    path: '',
    component: Bar,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', component: Home },
      { path: 'library', component: Library },
      { path: 'search', component: Search },
    ],
  },
  { path: 'detail/:id', component: Detail },
];
