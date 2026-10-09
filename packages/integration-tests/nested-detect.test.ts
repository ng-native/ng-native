/**
 * A change-detection pass begun inside another: a `detectChanges()` a component calls on itself
 * from a lifecycle hook, while the application's own pass is still under way. Angular tells the
 * renderer each one has ended, and the renderer commits when a pass ends. The inner ones are
 * part of the outer one: committed each on its own, a screen of a library's components is
 * committed once for every component as it is first built.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a change-detection pass begun inside another', () => {
  let Component: Type<unknown>;

  before(async () => {
    const mod = await compileFixture('fixtures/nested-detect.ts');
    Component = mod['NestedDetect'] as Type<unknown>;
  });

  it('commits with the pass around it: once for the screen, not once for each component', async () => {
    const fabric = createFakeFabric();
    const app = mount(1, Component, fabric);
    await settle();
    assert.match(fabric.render(), /RawText "checked"/, 'what the inner passes changed is there');
    assert.doesNotMatch(fabric.render(), /RawText "first"/);
    assert.equal(fabric.calls.completeRoot, 1);
    app.applicationRef.destroy();
  });

  it('still commits a pass begun on its own, with none around it', async () => {
    const fabric = createFakeFabric();
    const app = mount(1, Component, fabric);
    await settle();
    const commits = fabric.calls.completeRoot;
    (app.componentRef.instance as { count: WritableSignal<number> }).count.set(5);
    app.componentRef.changeDetectorRef.detectChanges();
    assert.equal(fabric.calls.completeRoot, commits + 1);
    assert.match(fabric.render(), /RawText "5"/);
    app.applicationRef.destroy();
  });
});
