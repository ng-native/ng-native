/**
 * `PLATFORM_ID` on a device.
 *
 * Angular's own default is `'unknown'`, which `isPlatformBrowser()` and `isPlatformServer()` both
 * answer false for, so a library could not tell a native app from anything else - and one that
 * guards its DOM work with `!isPlatformServer(id)` would reach for `document` and fail. A native
 * app says what it is, and `isPlatformNative()` asks it, alongside Angular's own two.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { PLATFORM_ID, type Type } from '@angular/core';
import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import { PLATFORM_NATIVE_ID, isPlatformNative, mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

describe('PLATFORM_ID on a device', () => {
  let Counter: Type<unknown>;

  before(async () => {
    const mod = await compileFixture('fixtures/counter.ts');
    Counter = mod['Counter'] as Type<unknown>;
  });

  it("is 'native'", () => {
    const app = mount(1, Counter, createFakeFabric());
    assert.equal(app.componentRef.injector.get(PLATFORM_ID), 'native');
    assert.equal(PLATFORM_NATIVE_ID, 'native');
  });

  it('is native, and neither a browser nor a server, to anything that asks', () => {
    const id = mount(1, Counter, createFakeFabric()).componentRef.injector.get(PLATFORM_ID);
    assert.equal(isPlatformNative(id), true);
    assert.equal(isPlatformBrowser(id), false);
    assert.equal(isPlatformServer(id), false);
  });

  it('answers false for the platforms Angular itself names', () => {
    assert.equal(isPlatformNative('browser'), false);
    assert.equal(isPlatformNative('server'), false);
  });
});
