import { Component, signal } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { Bar, Home, Library, TabStack } from './tab-stacks.ts';

/** An album with unsaved changes: it refuses a native dismissal and counts the attempts. */
@Component({
  selector: 'x-guarded-album',
  imports: [Text],
  template: `<text>album</text>`,
  host: {
    '[preventNativeDismiss]': 'refusing()',
    '(nativeDismissCancelled)': 'attempts.set(attempts() + 1)',
  },
})
export class GuardedAlbum {
  readonly attempts = signal(0);
  readonly refusing = signal(true);
  constructor() {
    albums.push(this);
  }
}

/** Every album made, newest last, for a test to reach the page on the screen. */
export const albums: GuardedAlbum[] = [];

export { Shell } from './tab-stacks.ts';

export const guardedAlbumRoutes: Routes = [
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
          { path: ':id', component: GuardedAlbum },
        ],
      },
    ],
  },
];
