import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ngOnChanges and a signal input', () => {
  it('fires for a signal input, on the first value and on every change', async () => {
    const mod = await compileFixture('fixtures/signal-onchanges.ts');
    const calls = mod['calls'] as number[];
    const fabric = createFakeFabric();
    const app = mount(1, mod['ProbeHost'] as Type<unknown>, fabric, {});
    await settle();
    const host = app.componentRef.instance as { n: { set(value: number): void } };

    host.n.set(2);
    await settle();
    host.n.set(3);
    await settle();

    console.log('[probe] ngOnChanges saw', JSON.stringify(calls));
    assert.deepEqual(calls, [1, 2, 3]);
  });
});
