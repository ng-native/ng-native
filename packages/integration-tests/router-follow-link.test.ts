/**
 * The Testing the router page's deep-link example, run as written: `followLink` opens a page above
 * the one `withLinkParent` puts it under, and the page under it is still there to query.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { cleanup, render, screen } from '@ng-native/testing';
import { followLink, type LinkParent } from '../router/src/native-links.ts';
import { provideNativeRouter, withLinkParent } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/about-pages.ts');
});

const linkParent: LinkParent = (url) => (url.startsWith('/about/') ? '/about' : null);

it('opens a link above the page it belongs under', async () => {
  const { componentRef } = await render(mod['App'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['routes'] as Routes, withLinkParent(linkParent))],
  });

  await followLink(componentRef.injector.get(Router), '/about/team', linkParent);

  assert.ok(await screen.findByText('Our team'));
  assert.ok(screen.getByText('We make apps'), 'the page it belongs under is beneath it');
});
