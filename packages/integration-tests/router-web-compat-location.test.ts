/**
 * `window.location` in an app with the native router: the page's address follows the route the
 * router is on, and `location.assign` to a page of the app is a navigation of the router.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { cleanup, render, screen } from '@ng-native/testing';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { provideWebCompat } from '../web-compat/src/index.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/about-pages.ts');
});

type Location = { href: string; pathname: string; search: string; assign(url: string): void };
const location = () => (globalThis as unknown as { location: Location }).location;

it("follows the router's route, and navigates it", async () => {
  const { componentRef } = await render(mod['App'] as Type<unknown>, {
    providers: [
      provideWebCompat({ url: 'canary://' }),
      provideNativeRouter(mod['routes'] as Routes),
    ],
  });
  assert.ok(await screen.findByText('Home'));
  assert.equal(location().href, 'canary:///');

  await componentRef.injector.get(Router).navigateByUrl('/about?from=home');
  assert.equal(location().pathname, '/about');
  assert.equal(location().search, '?from=home');
  assert.equal(
    (globalThis as unknown as { document: { URL: string } }).document.URL,
    location().href,
  );

  // Against the page, `canary:///about`, whose folder is the root, as a browser resolves it.
  location().assign('about/team');
  assert.ok(await screen.findByText('Our team'));
  assert.equal(location().href, 'canary:///about/team');
});
