/**
 * An outlet taken out of the tree leaves its parent's context alone once another outlet holds it,
 * as Angular's `RouterOutlet` does. A route's context is one object for every page that route's
 * outlet shows in turn: a page kept by the reuse strategy takes its children's outlets with it and
 * gets them back as it is attached. A stack in a sheet over the tab bar, dropped as the page under
 * the sheet is attached again, cleared the tab bar's registration, and every tab chosen after that
 * went into the first tab's stack. ng-native/ng-native#886
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { ChildrenOutletContexts, PRIMARY_OUTLET } from '@angular/router';
import { cleanup, render, settle } from '@ng-native/testing';
import { PRESENTED } from '../router/src/presented-route.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/outlet-registration.ts');
});
beforeEach(() => (mod['shown'] as WritableSignal<boolean>).set(true));

describe('an outlet taken out of the tree', () => {
  for (const [kind, host] of [
    ['stack', 'StackHost'],
    ['tab bar', 'TabsHost'],
  ] as const) {
    it(`leaves the ${kind}'s context to the outlet that holds it now`, async () => {
      const app = await render(mod[host] as Type<unknown>, {
        providers: [provideNativeRouter([])],
      });
      await settle();
      const contexts = app.componentRef.injector.get(ChildrenOutletContexts);
      const outlet = contexts.getContext(PRIMARY_OUTLET)?.outlet;
      assert.ok(outlet, 'the outlet is registered');

      // What the router does when it attaches a kept page: its own outlets' registrations return.
      const kept = { isActivated: true } as unknown as NonNullable<typeof outlet>;
      contexts.onChildOutletCreated(PRIMARY_OUTLET, kept);

      (mod['shown'] as WritableSignal<boolean>).set(false);
      await settle();
      assert.equal(
        contexts.getContext(PRIMARY_OUTLET)?.outlet,
        kept,
        'the outlet registered now is still registered',
      );
    });

    it(`still clears the ${kind}'s context when it is the one registered`, async () => {
      const app = await render(mod[host] as Type<unknown>, {
        providers: [provideNativeRouter([])],
      });
      await settle();
      const contexts = app.componentRef.injector.get(ChildrenOutletContexts);
      (mod['shown'] as WritableSignal<boolean>).set(false);
      await settle();
      assert.equal(contexts.getContext(PRIMARY_OUTLET)?.outlet, null);
    });
  }

  it("leaves the root stack's presented context to the outlet that holds it now", async () => {
    const app = await render(mod['StackHost'] as Type<unknown>, {
      providers: [provideNativeRouter([])],
    });
    await settle();
    const contexts = app.componentRef.injector.get(ChildrenOutletContexts);
    assert.ok(contexts.getContext(PRESENTED)?.outlet, 'the presented outlet is registered');
    const kept = { isActivated: false } as unknown as NonNullable<
      ReturnType<typeof contexts.getContext>
    >['outlet'];
    contexts.onChildOutletCreated(PRESENTED, kept!);

    (mod['shown'] as WritableSignal<boolean>).set(false);
    await settle();
    assert.equal(contexts.getContext(PRESENTED)?.outlet, kept);
  });

  it("still clears the root stack's presented context when it is the one registered", async () => {
    const app = await render(mod['StackHost'] as Type<unknown>, {
      providers: [provideNativeRouter([])],
    });
    await settle();
    const contexts = app.componentRef.injector.get(ChildrenOutletContexts);
    (mod['shown'] as WritableSignal<boolean>).set(false);
    await settle();
    assert.equal(contexts.getContext(PRESENTED)?.outlet, null);
  });
});
