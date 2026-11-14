/**
 * Route windows: a window that renders a named outlet of the app's one Router, so a deep link or a
 * relaunch restores it from the URL. `AppWindows` in `@ng-native/device` opens the window and asks
 * this, through `WINDOW_NAVIGATOR`, what to render in it and how to navigate it.
 */
import { inject, type Provider } from '@angular/core';
import { Router } from '@angular/router';
import { WINDOW_NAVIGATOR, type WindowNavigator } from '@ng-native/device';
import { NativeStackOutlet } from './native-stack-outlet.ts';
import { WINDOW_OUTLET } from './window-outlet.ts';

/** The URL segments of `path`, which may start with a slash. */
const segments = (path: string): string[] => path.split('/').filter(Boolean);

function windowNavigator(): WindowNavigator {
  const router = inject(Router);
  return {
    window: (outlet) => ({
      component: NativeStackOutlet,
      providers: [{ provide: WINDOW_OUTLET, useValue: outlet }],
    }),
    navigate: (outlet, path) => router.navigate([{ outlets: { [outlet]: segments(path) } }]),
    // A window closing leaves the primary outlet where it is, and the URL without the window.
    clear: (outlet) => router.navigate([{ outlets: { [outlet]: null } }]),
  };
}

/** What `provideNativeRouter` adds so `AppWindows` can open route windows. */
export const routeWindows: Provider = { provide: WINDOW_NAVIGATOR, useFactory: windowNavigator };
