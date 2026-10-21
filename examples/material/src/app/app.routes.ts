import type { Routes } from '@angular/router';

// Lazy, and it has to be: the CDK adds a listener to the window as its modules load, and the
// window has listeners only once `provideWebCompat()` has run.
export const routes: Routes = [
  { path: '', loadComponent: () => import('./tasks/tasks-page.ts').then((m) => m.TasksPage) },
];
