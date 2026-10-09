/**
 * `withHeaderDefaults` and `withTabDefaults`: how every bar in the app looks, said once beside the
 * routes rather than on each `<native-header>` and `<native-tabs-outlet>`.
 *
 * A bar's appearance is props, and a prop cannot read the cascade, so without these an app that
 * wants its bars to match its pages repeats the same six bindings on every screen. The defaults
 * only fill what a call site left unset, and a default can be a function of the colour scheme so
 * a bar follows the system appearance the way a page's `prefers-color-scheme` rules do.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { ColorScheme, type Scheme } from '@ng-native/device';
import { cleanup, render, screen, settle } from '@ng-native/testing';
import {
  provideNativeRouter,
  withHeaderDefaults,
  withTabDefaults,
  type NativeRouterFeature,
} from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

describe('app-wide defaults for native bars', () => {
  let mod: Record<string, unknown>;
  let router: Router;
  /** Switches the system appearance, as the user flipping dark mode would. */
  let switchTo: (scheme: Scheme) => Promise<void>;

  before(async () => {
    mod = await compileFixture('fixtures/router-defaults.ts');
  });

  afterEach(() => cleanup());

  const boot = async (url: string, ...features: NativeRouterFeature[]) => {
    let scheme: Scheme = 'light';
    const listeners = new Set<(scheme: Scheme) => void>();
    const app = await render(mod['Shell'] as Type<unknown>, {
      processColor: (value) => `processed:${String(value)}`,
      providers: [
        provideNativeRouter(mod['routes'] as Routes, ...features),
        {
          provide: ColorScheme.SOURCE,
          useValue: {
            current: () => scheme,
            subscribe: (listener: (next: Scheme) => void) => (
              listeners.add(listener),
              () => listeners.delete(listener)
            ),
          },
        },
      ],
    });
    switchTo = async (next) => {
      scheme = next;
      listeners.forEach((listener) => listener(next));
      await settle();
    };
    router = app.componentRef.injector.get(Router);
    await router.navigateByUrl(url);
    await settle();
  };

  const props = (id: string) => screen.getByTestId(id).props;

  describe('withHeaderDefaults', () => {
    const fixed = withHeaderDefaults({
      backgroundColor: '#101014',
      color: '#3b6ef5',
      titleColor: '#ffffff',
      blurEffect: 'none',
      userInterfaceStyle: 'dark',
      hideShadow: true,
      translucent: false,
      largeTitleColor: '#eeeeee',
      titleFontWeight: '600',
      backButtonDisplayMode: 'minimal',
    });

    it('applies to a header that binds nothing', async () => {
      await boot('/plain', fixed);
      const bar = props('plain-bar');
      assert.equal(bar['backgroundColor'], 'processed:#101014');
      assert.equal(bar['color'], 'processed:#3b6ef5');
      assert.equal(bar['titleColor'], 'processed:#ffffff');
      assert.equal(bar['blurEffect'], 'none');
      assert.equal(bar['userInterfaceStyle'], 'dark');
      assert.equal(bar['hideShadow'], true);
      assert.equal(bar['translucent'], false);
      assert.equal(bar['largeTitleColor'], 'processed:#eeeeee');
      assert.equal(bar['titleFontWeight'], '600');
      assert.equal(bar['backButtonDisplayMode'], 'minimal');
    });

    it('gives way to whatever a header binds itself', async () => {
      await boot('/own', fixed);
      const bar = props('own-bar');
      assert.equal(bar['backgroundColor'], 'processed:#ff0000');
      assert.equal(bar['blurEffect'], 'regular');
      assert.equal(bar['userInterfaceStyle'], 'light');
      assert.equal(bar['hideShadow'], false, 'an explicit false is a choice, not a gap');
      assert.equal(bar['color'], 'processed:#3b6ef5', 'and the rest still come from the defaults');
    });

    it('follows the colour scheme when given as a function of it', async () => {
      await boot(
        '/plain',
        withHeaderDefaults((scheme) => ({
          backgroundColor: scheme === 'dark' ? '#101014' : '#f4f4f7',
          userInterfaceStyle: scheme,
        })),
      );
      assert.equal(props('plain-bar')['backgroundColor'], 'processed:#f4f4f7');
      assert.equal(props('plain-bar')['userInterfaceStyle'], 'light');

      await switchTo('dark');
      assert.equal(props('plain-bar')['backgroundColor'], 'processed:#101014');
      assert.equal(props('plain-bar')['userInterfaceStyle'], 'dark');
    });

    it('still falls back to the built-in palette for colours it does not name', async () => {
      await boot('/plain', withHeaderDefaults({ blurEffect: 'none' }));
      assert.equal(props('plain-bar')['backgroundColor'], 'processed:rgb(255, 255, 255)');
      assert.equal(props('plain-bar')['blurEffect'], 'none');
    });

    it('changes nothing for an app that does not ask', async () => {
      await boot('/plain');
      assert.equal(props('plain-bar')['blurEffect'], undefined);
      assert.equal(props('plain-bar')['userInterfaceStyle'], undefined);
    });
  });

  describe('withTabDefaults', () => {
    const tabs = withTabDefaults((scheme) => ({
      tintColor: '#3b6ef5',
      backgroundColor: scheme === 'dark' ? '#101014' : '#f4f4f7',
      colorScheme: scheme,
      standardAppearance: { tabBarBackgroundColor: scheme === 'dark' ? '#1c1c24' : '#ffffff' },
    }));

    it('applies to the outlet and to a tab that binds nothing', async () => {
      await boot('/tabs', tabs);
      const outlet = props('tabs');
      assert.equal(outlet['tabBarTintColor'], 'processed:#3b6ef5');
      assert.equal(outlet['nativeContainerBackgroundColor'], 'processed:#f4f4f7');
      assert.equal(outlet['colorScheme'], 'light');
      const appearance = props('first-tab')['standardAppearance'] as Record<string, unknown>;
      assert.equal(appearance['tabBarBackgroundColor'], 'processed:#ffffff');
    });

    it('gives way to what an outlet or a tab binds itself', async () => {
      await boot('/tabs', tabs);
      const own = props('second-tab')['standardAppearance'] as Record<string, unknown>;
      assert.equal(own['tabBarBackgroundColor'], 'processed:#00ff00');

      await router.navigateByUrl('/own-tabs');
      await settle();
      assert.equal(props('own-tabs')['tabBarTintColor'], 'processed:#ff00ff');
      assert.equal(props('own-tabs')['colorScheme'], 'light');
      assert.equal(
        props('own-tabs')['nativeContainerBackgroundColor'],
        'processed:#f4f4f7',
        'what it left unset still comes from the defaults',
      );
    });

    it('follows the colour scheme', async () => {
      await boot('/tabs', tabs);
      await switchTo('dark');
      assert.equal(props('tabs')['nativeContainerBackgroundColor'], 'processed:#101014');
      assert.equal(props('tabs')['colorScheme'], 'dark');
      const appearance = props('first-tab')['standardAppearance'] as Record<string, unknown>;
      assert.equal(appearance['tabBarBackgroundColor'], 'processed:#1c1c24');
    });
  });
});
