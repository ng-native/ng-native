/**
 * `Renderer2.setStyle` receives what Angular's compiler emits for the DOM: a dash-cased name when
 * the binding was written that way, and a unit suffix as part of the value. Fabric reads neither,
 * and drops both without a word.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('style bindings through the renderer', () => {
  it('normalises dash-case names and px units into what Fabric reads', async () => {
    const mod = await compileFixture('fixtures/style-bindings.ts');
    const fabric = createFakeFabric();
    mount(1, mod['StyleBindings'] as Type<unknown>, fabric);
    await settle();

    const { nativeID: _id, ...style } = fabric.committed[0]!.children[0]!.props;
    assert.deepEqual(style, { width: 10, fontSize: 12, opacity: 0.5, maxWidth: '50%' });
  });
});
