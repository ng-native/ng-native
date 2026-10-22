import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./tasks/tasks-page.ts').then((m) => m.TasksPage) },
];
