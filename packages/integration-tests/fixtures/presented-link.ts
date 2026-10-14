import { Component } from '@angular/core';
import type { Routes } from '@angular/router';
import { Pressable } from '../../components/src/pressable.ts';
import { Text } from '../../components/src/text.ts';
import { NativeRouterLink } from '../../router/src/native-router-link.ts';
import { Bar, Home, Library, TabStack } from './tab-stacks.ts';

export { Shell } from './tab-stacks.ts';

/** An album with links to another album: one absolute, one relative to the album itself. */
@Component({
  selector: 'x-album',
  imports: [Pressable, Text, NativeRouterLink],
  template: `
    <text>album</text>
    <pressable testID="absolute" nativeRouterLink="/library/9"><text>next album</text></pressable>
    <pressable testID="relative" [nativeRouterLink]="['..', '9']"><text>rel album</text></pressable>
  `,
})
export class Album {}

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
];
