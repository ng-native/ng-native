import type { RouteMeta } from '@analogjs/router';

/** A page with no component, only `routeMeta`: an old `/old-home` link lands on the home page. */
export const routeMeta: RouteMeta = {
  redirectTo: '/',
  pathMatch: 'full',
};
