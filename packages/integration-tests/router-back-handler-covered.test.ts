/**
 * A screen's own `HardwareBack` handler, while another screen is pushed over it. React Native asks
 * the newest handler first, and the screen below subscribed after the stack it is in, so its
 * handler answered a press meant for the screen on top.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { HardwareBack } from '@ng-native/device';
import { cleanup, render, settle } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

describe("a screen's back handler under a screen pushed over it", () => {
  let mod: Record<string, unknown>;
  let router: Router;
  let navigation: NativeNavigation;
  let form: { taken: number };
  /** Every handler the app gave the button, oldest first, as React Native holds them. */
  let handlers: (() => boolean)[];

  const pressBack = async (): Promise<boolean> => {
    const taken = [...handlers].reverse().some((handler) => handler());
    await settle();
    await settle();
    return taken;
  };

  before(async () => {
    mod = await compileFixture('fixtures/back-handler-screens.ts');
    form = mod['form'] as { taken: number };
  });

  beforeEach(async () => {
    handlers = [];
    form.taken = 0;
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(mod['routes'] as Routes),
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
    navigation = app.componentRef.injector.get(NativeNavigation);
    await settle();
    assert.equal(router.url, '/');
  });

  afterEach(() => cleanup());

  it('control: answers the button while its screen is in front', async () => {
    assert.equal(await pressBack(), true);
    assert.equal(form.taken, 1);
  });

  it('leaves the button to the stack, which pops the screen on top', async () => {
    await router.navigateByUrl('/picker');
    await settle();
    assert.equal(await pressBack(), true);
    assert.equal(form.taken, 0, 'the form is not the screen the user is on');
    assert.equal(router.url, '/');
  });

  it('answers the button again once the screen over it is gone', async () => {
    await router.navigateByUrl('/picker');
    await settle();
    await pressBack();
    assert.equal(await pressBack(), true);
    assert.equal(form.taken, 1);
  });

  it('leaves the button to a sheet presented over it, which it dismisses', async () => {
    await navigation.present('/picker', { as: 'formSheet' });
    await settle();
    assert.equal(router.url, '/picker');
    assert.equal(await pressBack(), true);
    assert.equal(form.taken, 0);
    assert.equal(router.url, '/');
  });

  it('leaves the button to a stack inside a modal over it, screen by screen', async () => {
    await navigation.present('/flow', { as: 'modal' });
    await settle();
    await navigation.push('/flow/step');
    await settle();
    assert.equal(router.url, '/flow/step');

    await pressBack();
    assert.equal(router.url, '/flow', 'the modal s own stack pops first');
    await pressBack();
    assert.equal(router.url, '/', 'then the modal goes');
    assert.equal(form.taken, 0);
    await pressBack();
    assert.equal(form.taken, 1, 'and the form, in front again, is asked');
  });

  it('leaves the button to a stack inside a tab over it, screen by screen', async () => {
    await router.navigateByUrl('/tabs/one');
    await settle();
    await navigation.push('/tabs/one/step');
    await settle();
    assert.equal(router.url, '/tabs/one/step');

    await pressBack();
    assert.equal(router.url, '/tabs/one', 'the tab s own stack pops first');
    await pressBack();
    assert.equal(router.url, '/', 'then the screen holding the tab bar');
    assert.equal(form.taken, 0);
  });
});
