/**
 * A number input with a default, bound to `undefined`: the default, as a prop left out is in React
 * Native. Angular's own `numberAttribute` makes it `NaN`, which no timer or layout can use. A boolean
 * bound to `undefined` is false, as it is in any Angular template.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { fireEvent, render, screen, settle, type FakeFabricNode } from '@ng-native/testing';
import { compileSource } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

async function build(name: string, source: string): Promise<Record<string, unknown>> {
  const file = path.join(import.meta.dirname, `input-defaults-${name}.fixture.ts`);
  return compileSource(source, file, file.replace(/\.ts$/, '.generated.ts'));
}

describe('a number input bound to undefined', () => {
  it('waits the default delay before a long press', async () => {
    const mod = await build(
      'press',
      `
import { Component } from '@angular/core';
import { Pressable } from '../components/src/pressable.ts';
@Component({
  selector: 'x-press',
  imports: [Pressable],
  template: '<pressable nativeID="btn" [delayLongPress]="delay" (longPress)="longs = longs + 1"></pressable>',
})
export class Press { longs = 0; delay: number | undefined = undefined; }
`,
    );
    const result = await render(mod['Press'] as Type<{ longs: number }>);
    const btn = screen.getByTestId('btn');
    await fireEvent(btn, 'topTouchStart', {
      touches: [{ pageX: 1, pageY: 1 }],
      changedTouches: [{ pageX: 1, pageY: 1 }],
      pageX: 1,
      pageY: 1,
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(
      result.instance.longs,
      0,
      'default delay is 500ms; 50ms in there is no long press',
    );
  });

  it('lays a list out with the default gap and overscan', async () => {
    const mod = await build(
      'list',
      `
import { Component } from '@angular/core';
import { Text } from '../components/src/text.ts';
import { View } from '../components/src/view.ts';
import { VirtualList } from '../components/src/virtual-list.ts';
@Component({
  selector: 'x-list',
  imports: [VirtualList, Text, View],
  template: \`<virtual-list #list [items]="rows" [itemHeight]="40" [rowGap]="gap" [overscan]="over">
    @for (row of list.window(); track row.index) { <view [style]="row.style"><text>{{ row.item }}</text></view> }
  </virtual-list>\`,
})
export class List { rows = ['a','b','c','d']; gap: number | undefined = undefined; over: number | undefined = undefined; }
`,
    );
    const { fabric } = await render(mod['List'] as Type<unknown>);
    const host = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
    await fireEvent(host, 'layout', { layout: { height: 400 } });
    await settle?.();
    const fresh = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
    const canvas = fresh.children[0]!.children[1]!;
    assert.equal(
      canvas.props['height'],
      160,
      `canvas height was ${String(canvas.props['height'])}`,
    );
  });
});
