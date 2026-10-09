import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { mount } from '@ng-native/platform';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((r) => setTimeout(r, 0));
const flat = (n: FakeFabricNode[]): FakeFabricNode[] => n.flatMap((x) => [x, ...flat(x.children)]);

describe('activity indicator sizing', () => {
  it('sizes every instance, with or without a template style', async () => {
    const mod = await compileFixture('fixtures/spinner.ts');
    const fabric = createFakeFabric();
    const app = mount(1, mod['Spinner'] as Type<unknown>, fabric);
    await settle();

    const spinners = flat(fabric.committed).filter((n) => n.viewName === 'ActivityIndicatorView');
    assert.equal(spinners.length, 3);
    spinners.forEach((s, i) => console.log(`      [${i}]`, JSON.stringify(s.props)));

    assert.equal(spinners[0]!.props['width'], 20, 'plain: host style must still size it');
    assert.equal(spinners[1]!.props['width'], 20, 'with a template style too');
    assert.equal(spinners[2]!.props['width'], 36, 'size="large"');

    app.applicationRef.destroy();
  });
});
