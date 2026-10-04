import type { Routes } from '@angular/router';

/** Each screen is loaded the first time it is opened. */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./library/library.ts').then((m) => m.Library),
  },
  {
    path: 'notes/:slug',
    loadComponent: () => import('./note/note-screen.ts').then((m) => m.NoteScreen),
  },
  {
    path: 'editor',
    loadComponent: () => import('./editor/editor.ts').then((m) => m.Editor),
  },
  {
    path: 'styled',
    loadComponent: () => import('./styled/styled-note.ts').then((m) => m.StyledNote),
  },
];
