/**
 * A tab that is not in the bar when the app starts, and is added later, as a feature flag does
 * when it turns on.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { HardwareBack } from '@ng-native/device';
import { registerPlatformComponents } from '@ng-native/fabric';
import {
  cleanup,
  fireEvent,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { registerScreenComponents } from '../router/src/screens.ts';
import { compileFixture } from './compile.ts';

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

async function idle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

describe('a tab added after start', () => {
  let mod: Record<string, unknown>;
  let betaEnabled: WritableSignal<boolean>;
  let router: Router;
  let fabric: FakeFabric;
  let provenance = 0;

  const host = () => flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;
  const selected = () =>
    (host().props['navStateRequest'] as { selectedScreenKey: string }).selectedScreenKey;
  /** The text nodes of the page in the tab the bar has for `key`. */
  const pageOf = (key: string) =>
    flatten(host().children.filter((screen) => screen.props['screenKey'] === key)).filter(
      (node) => node.viewName === 'RawText',
    );
  const tap = async (key: string) => {
    await fireEvent(host(), 'tabSelected', { selectedScreenKey: key, provenance: ++provenance });
    await idle();
  };

  before(async () => {
    mod = await compileFixture('fixtures/tab-changes.ts');
    betaEnabled = mod['betaEnabled'] as WritableSignal<boolean>;
  });

  beforeEach(async () => {
    betaEnabled.set(false);
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [provideNativeRouter(mod['routes'] as Routes)],
    });
    fabric = app.fabric;
    router = app.componentRef.injector.get(Router);
    await idle();
    assert.equal(router.url, '/home');
    assert.equal(selected(), 'home');

    betaEnabled.set(true);
    await idle();
  });

  afterEach(() => cleanup());

  it('opens a tab a flag added after start, on a tap', async () => {
    await tap('beta');
    assert.equal(router.url, '/beta');
    assert.equal(selected(), 'beta');
  });

  it('shows the page of a tab taken away and added again, in the tab it has now', async () => {
    await tap('beta');
    assert.equal(pageOf('beta').length, 1);
    await tap('home');

    betaEnabled.set(false);
    await idle();
    betaEnabled.set(true);
    await idle();
    await tap('beta');
    assert.equal(router.url, '/beta');
    assert.equal(pageOf('beta').length, 1, 'the page is in the tab that is in the bar');
  });

  it('shows the page of the tab in front, taken away and added again while it is showing', async () => {
    await tap('beta');
    betaEnabled.set(false);
    await idle();
    betaEnabled.set(true);
    await idle();
    assert.equal(router.url, '/beta');
    assert.equal(pageOf('beta').length, 1, 'with no tap or navigation to read the tabs again');
  });

  it('opens a tab a flag added after start, on a navigation', async () => {
    assert.equal(await router.navigateByUrl('/beta'), true);
    await idle();
    assert.equal(router.url, '/beta');
    assert.equal(selected(), 'beta');
  });
});

describe("Android's back with the first tab taken away", () => {
  let mod: Record<string, unknown>;
  let promoEnabled: WritableSignal<boolean>;
  let router: Router;
  let handlers: (() => boolean)[];

  const pressBack = async (): Promise<boolean> => {
    const taken = [...handlers].reverse().some((handler) => handler());
    await idle();
    return taken;
  };
  const go = async (url: string) => {
    assert.equal(await router.navigateByUrl(url), true);
    await idle();
  };
  const showPromo = async (shown: boolean) => {
    promoEnabled.set(shown);
    await idle();
  };

  before(async () => {
    registerPlatformComponents('android');
    registerScreenComponents();
    mod = await compileFixture('fixtures/tab-changes.ts');
    promoEnabled = mod['promoEnabled'] as WritableSignal<boolean>;
  });

  after(() => {
    promoEnabled.set(true);
    registerPlatformComponents('ios');
    registerScreenComponents();
  });

  const start = async (promo: boolean) => {
    handlers = [];
    promoEnabled.set(promo);
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(mod['promoRoutes'] as Routes),
        {
          provide: HardwareBack.SOURCE,
          useValue: {
            subscribe: (handler: () => boolean) => {
              handlers.push(handler);
              return () => handlers.splice(handlers.indexOf(handler), 1);
            },
          },
        },
      ],
    });
    router = app.componentRef.injector.get(Router);
    await idle();
    assert.equal(router.url, '/home');
  };

  afterEach(() => cleanup());

  it('goes to the first tab still in the bar', async () => {
    await start(true);
    await go('/promo');
    await go('/library');
    await showPromo(false);

    assert.equal(await pressBack(), true);
    assert.equal(router.url, '/home', 'not to the promo tab, which is not in the bar');
  });

  it('declines on the first tab still in the bar, so the platform leaves the app', async () => {
    await start(true);
    await showPromo(false);

    assert.equal(await pressBack(), false, 'nothing in the app takes it');
    assert.equal(router.url, '/home');
  });

  it('goes to the first tab again once it is back in the bar', async () => {
    await start(true);
    await go('/promo');
    await go('/library');
    await showPromo(false);
    await showPromo(true);

    assert.equal(await pressBack(), true);
    assert.equal(router.url, '/promo');
  });

  it('goes to a first tab that was not in the bar when the app started', async () => {
    await start(false);
    await showPromo(true);

    assert.equal(await pressBack(), true, 'home is no longer the first tab');
    assert.equal(router.url, '/promo');
  });
});
