import { execFileSync } from 'node:child_process';
import { Component } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { provideWebCompat } from '@ng-native/web-compat';
import { cleanup, render, screen, settle, userEvent } from '@ng-native/testing';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { SpartanNavigation } from './spartan-navigation.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

@Component({ template: '' })
class Anywhere {}

const mount = () =>
  render(SpartanNavigation, {
    globalStyles: tailwind as never,
    providers: [provideWebCompat(), provideRouter([{ path: '**', component: Anywhere }])],
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });

const muted = 'rgb(106, 114, 130)';

test('a breadcrumb is a row of links that wraps, with the page it ends on in the foreground', async () => {
  await mount();
  expect(screen.getByTestId('breadcrumb-list').props).toMatchObject({
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  });
  expect(screen.getByText('Home').props['color']).toBe(muted);
  expect(screen.getByTestId('crumb-home').props).toMatchObject({ accessibilityRole: 'link' });
  expect(screen.getByTestId('crumb-page').props['color']).toBe('rgb(3, 7, 18)');
});

test('pressing a link goes where it points, through the router', async () => {
  const app = await mount();
  const router = app.componentRef.injector.get(Router);
  await userEvent.press(screen.getByTestId('page-1'));
  await settle();
  expect(router.url).toBe('/spartan');
  await userEvent.press(screen.getByTestId('crumb-home'));
  await settle();
  expect(router.url).toBe('/');
});

test('pagination is a centred row, with the page it is on outlined', async () => {
  await mount();
  expect(screen.getByTestId('pagination').props).toMatchObject({ justifyContent: 'center' });
  expect(screen.getByTestId('pagination-list').props).toMatchObject({ flexDirection: 'row' });
  const [on, off] = [screen.getByTestId('page-2').props, screen.getByTestId('page-1').props];
  expect(on).toMatchObject({ borderTopWidth: 1, width: 36, height: 36 });
  expect(on['borderTopColor']).toBe('rgb(229, 231, 235)');
  expect(off['borderTopColor']).toBe('rgba(0, 0, 0, 0)');
});
