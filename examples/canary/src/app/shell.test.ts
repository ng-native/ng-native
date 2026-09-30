import { withComponentInputBinding } from '@angular/router';
import { ColorScheme, StatusBar, type Scheme, type StatusBarSource } from '@ng-native/device';
import { provideNativeRouter } from '@ng-native/router';
import { render } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from './app.ts';
import { routes } from './app.routes.ts';

test("claims the status bar's auto style, which follows the scheme and a theme switch", async () => {
  const styles: string[] = [];
  const bar: StatusBarSource = {
    setStyle: (style) => void styles.push(style),
    setHidden: () => {},
    setBackgroundColor: () => {},
    setTranslucent: () => {},
    height: undefined,
  };
  let scheme: Scheme = 'light';
  const listeners = new Set<(scheme: Scheme) => void>();
  const colors = {
    current: () => scheme,
    subscribe: (listener: (scheme: Scheme) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  const { componentRef } = await render(App, {
    providers: [
      provideNativeRouter(routes, withComponentInputBinding()),
      { provide: StatusBar.SOURCE, useValue: bar },
      { provide: ColorScheme.SOURCE, useValue: colors },
    ],
  });
  expect(componentRef.injector.get(StatusBar).state().style).toBe('auto');
  expect(styles.at(-1)).toBe('dark');

  scheme = 'dark';
  for (const listener of listeners) listener(scheme);
  expect(styles.at(-1)).toBe('light');
});
