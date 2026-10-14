/**
 * CSS written in a `style` attribute or bound as text, where it means what a stylesheet means by
 * it: a shorthand with a value for each side, and a `line-height` with no unit, which is a
 * multiple of the font size. Native takes neither, and drops what it cannot read without a word.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { render, settle, type FakeFabricNode } from '@ng-native/testing';
import { compileSource } from './compile.ts';

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

async function build(name: string, source: string): Promise<Record<string, unknown>> {
  const file = path.join(import.meta.dirname, `inline-style-css-${name}.fixture.ts`);
  return compileSource(source, file, file.replace(/\.ts$/, '.generated.ts'));
}

/** The style props of the node with `id`, the given ones only. */
function styleOf(fabric: { committed: readonly FakeFabricNode[] }, id: string, keys: string[]) {
  const node = flatten(fabric.committed).find((one) => one.props['nativeID'] === id)!;
  const style = (node.props['style'] ?? {}) as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, node.props[key] ?? style[key]]));
}

const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
const padding = ['padding', ...SIDES.map((side) => `padding${side}`)];

describe('a shorthand with several values in a style', () => {
  it('goes to each side from a style attribute', async () => {
    const mod = await build(
      'sides',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-sides',
  imports: [View],
  template: '<view nativeID="box" style="padding: 4px 8px; margin: 1px 2px 3px 4px; gap: 5px 6px; inset: 0 7px 9px"></view>',
})
export class Sides {}
`,
    );
    const { fabric } = await render(mod['Sides'] as Type<unknown>);
    assert.deepEqual(styleOf(fabric, 'box', padding), {
      padding: undefined,
      paddingTop: 4,
      paddingRight: 8,
      paddingBottom: 4,
      paddingLeft: 8,
    });
    assert.deepEqual(styleOf(fabric, 'box', ['margin', ...SIDES.map((side) => `margin${side}`)]), {
      margin: undefined,
      marginTop: 1,
      marginRight: 2,
      marginBottom: 3,
      marginLeft: 4,
    });
    assert.deepEqual(styleOf(fabric, 'box', ['gap', 'rowGap', 'columnGap']), {
      gap: undefined,
      rowGap: 5,
      columnGap: 6,
    });
    assert.deepEqual(styleOf(fabric, 'box', ['inset', 'top', 'right', 'bottom', 'left']), {
      inset: undefined,
      top: 0,
      right: 7,
      bottom: 9,
      left: 7,
    });
  });

  it('follows a binding to one value, and to none', async () => {
    const mod = await build(
      'bound',
      `
import { Component, signal } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-bound',
  imports: [View],
  template: '<view nativeID="box" [style.padding]="pad()"></view>',
})
export class Bound { readonly pad = signal<string | undefined>('4px 8px'); }
`,
    );
    const { fabric, instance } = await render(
      mod['Bound'] as Type<{ pad: { set(value: string | undefined): void } }>,
    );
    assert.equal(styleOf(fabric, 'box', padding)['paddingRight'], 8);

    instance.pad.set('2px');
    await settle();
    assert.deepEqual(styleOf(fabric, 'box', padding), {
      padding: 2,
      paddingTop: undefined,
      paddingRight: undefined,
      paddingBottom: undefined,
      paddingLeft: undefined,
    });

    instance.pad.set('1px 3px');
    await settle();
    instance.pad.set(undefined);
    await settle();
    assert.deepEqual(
      styleOf(fabric, 'box', padding),
      Object.fromEntries(padding.map((key) => [key, undefined])),
    );
  });
});

describe('a side shorthand bound beside one of its sides', () => {
  it('leaves the side alone once the shorthand is one value again', async () => {
    const mod = await build(
      'side',
      `
import { Component, signal } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-side',
  imports: [View],
  template: '<view nativeID="box" [style.padding]="pad()" [style.padding-top.px]="top()"></view>',
})
export class Side {
  readonly pad = signal('4px 8px');
  readonly top = signal<number | undefined>(undefined);
}
`,
    );
    const { fabric, instance } = await render(
      mod['Side'] as Type<{
        pad: { set(value: string): void };
        top: { set(value: number): void };
      }>,
    );
    instance.pad.set('2px');
    await settle();
    instance.top.set(5);
    await settle();
    instance.pad.set('3px');
    await settle();
    assert.deepEqual(styleOf(fabric, 'box', ['padding', 'paddingTop']), {
      padding: 3,
      paddingTop: 5,
    });
  });
});

describe('a line-height with no unit in a style', () => {
  it('is a multiple of the font size, as in a stylesheet', async () => {
    const mod = await build(
      'line',
      `
import { Component } from '@angular/core';
import { Text } from '../components/src/text.ts';
@Component({
  selector: 'x-line',
  imports: [Text],
  template: \`
    <text nativeID="attribute" style="line-height: 1.5; font-size: 20px">a</text>
    <text nativeID="bound" [style.line-height]="'1.5'" [style.font-size.px]="20">b</text>
    <text nativeID="sheet" class="c">c</text>
    <text nativeID="points" [style]="{ lineHeight: 24, fontSize: 20 }">d</text>
  \`,
  styles: '.c { line-height: 1.5; font-size: 20px; }',
})
export class Line {}
`,
    );
    const { fabric } = await render(mod['Line'] as Type<unknown>);
    const line = (id: string) => styleOf(fabric, id, ['lineHeight'])['lineHeight'];
    assert.equal(line('sheet'), 30, 'control: the stylesheet');
    assert.equal(line('attribute'), 30);
    assert.equal(line('bound'), 30);
    assert.equal(line('points'), 24, 'a number in a style object is points, as in React Native');
  });
});
