import { InjectionToken, type WritableSignal } from '@angular/core';

/**
 * Whether a sidebar item is the selected one. A `<sidebar-item>` provides it, the router's
 * `sidebar-item[path]` directive writes it as the route changes, and the item's `[(selected)]`
 * reads it back. It lives here because the components and the router packages cannot import each
 * other. There is none outside a sidebar item.
 */
export const SIDEBAR_SELECTION = new InjectionToken<WritableSignal<boolean>>(
  'angular-native.sidebarSelection',
);
