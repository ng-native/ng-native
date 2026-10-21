/**
 * A shorthand in an element's inline style over a longhand its stylesheet sets.
 *
 * In a browser `style="padding: 10px"` sets all four sides, and so beats a rule's `padding-top`.
 * A native view takes both as props of their own and does not ask which came later: Yoga and
 * React Native read the more specific edge or corner first. So the cascade's longhand takes the
 * value of an inline shorthand that covers it, unless the rule marked it `!important`.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine, type EngineNode } from '@ng-native/fabric';
import {
  compileCss,
  createFakeFabric,
  render,
  settle,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileSource } from './compile.ts';

const BASE = { width: 400, height: 800, colorScheme: 'light' as const };

/** One view with `classes` under `css`, and what it last committed. */
function scene(css: string, classes: string, direction?: 'ltr' | 'rtl') {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css, 'app.css') as never,
    conditions: { ...BASE, ...(direction && { direction }) },
  });
  const node: EngineNode = engine.createElement('view');
  engine.setClasses(node, classes);
  engine.appendChild(engine.root, node);
  const props = (): Record<string, unknown> => {
    engine.commit();
    return fabric.committed[0]!.props;
  };
  const style = (style: Record<string, unknown> | null) => engine.setProp(node, 'style', style);
  return { engine, node, props, style };
}

/** Set, and not null: a prop native was sent `null` for is gone from what it holds. */
const has = (props: Record<string, unknown>, key: string) => props[key] != null;

describe('an inline shorthand over a longhand from a stylesheet', () => {
  const covered: [css: string, inline: Record<string, unknown>, over: string[], kept?: string][] = [
    ['padding-top: 4px', { padding: 10 }, ['paddingTop']],
    ['margin-top: 4px; margin-left: 4px', { margin: 10 }, ['marginTop', 'marginLeft']],
    ['top: 4px; left: 4px', { inset: 10 }, ['top', 'left']],
    ['row-gap: 4px; column-gap: 4px', { gap: 10 }, ['rowGap', 'columnGap']],
    ['border-top-width: 4px', { borderWidth: 10 }, ['borderTopWidth']],
    ['border-top-color: red', { borderColor: 'blue' }, ['borderTopColor']],
    ['border-top-left-radius: 4px', { borderRadius: 10 }, ['borderTopLeftRadius']],
    ['border-start-start-radius: 4px', { borderRadius: 10 }, ['borderStartStartRadius']],
    ['margin-inline-start: 4px', { margin: 10 }, ['marginStart']],
    ['padding-inline-end: 4px', { padding: 10 }, ['paddingEnd']],
    [
      'padding-left: 4px; padding-inline-end: 4px; padding-top: 3px',
      { paddingHorizontal: 10 },
      ['paddingLeft', 'paddingEnd'],
      'paddingTop',
    ],
    [
      'margin-top: 4px; margin-bottom: 4px; margin-left: 3px',
      { marginVertical: 10 },
      ['marginTop', 'marginBottom'],
      'marginLeft',
    ],
    ['padding-top: 4px', { paddingBlock: 10 }, ['paddingTop']],
    ['margin-right: 4px', { marginInline: 10 }, ['marginRight']],
    ['border-top-color: red', { borderBlockColor: 'blue' }, ['borderTopColor']],
  ];

  for (const [css, inline, over, kept] of covered) {
    const [shorthand] = Object.keys(inline);
    const value = inline[shorthand!];
    it(`gives ${over.join(' and ')} the value of an inline ${shorthand}`, () => {
      const s = scene(`.a { ${css} }`, 'a');
      const before = s.props();
      for (const key of over) assert.equal(has(before, key), true, `control: ${key}`);
      const left = kept && before[kept];
      s.style(inline);
      const props = s.props();
      assert.equal(props[shorthand!], value);
      for (const key of over) assert.equal(props[key], value, key);
      if (kept) assert.equal(props[kept], left, `and leaves ${kept}, which it does not cover`);
    });
  }

  it('gives the longhand its own value back when the inline shorthand goes', () => {
    const s = scene('.a { padding-top: 4px; border-top-color: red }', 'a');
    s.style({ padding: 10, borderColor: 'blue' });
    assert.equal(s.props()['paddingTop'], 10);
    s.style({ borderColor: 'blue' });
    assert.equal(s.props()['paddingTop'], 4);
    assert.equal(has(s.props(), 'padding'), false, 'sent null');
    assert.equal(s.props()['borderTopColor'], 'blue');
    s.style(null);
    assert.equal(s.props()['borderTopColor'], 'rgb(255, 0, 0)');
    assert.equal(has(s.props(), 'borderColor'), false, 'sent null');
  });

  it('adds no longhand the stylesheet does not set', () => {
    const s = scene('.a { padding-top: 4px }', 'a');
    s.style({ padding: 10 });
    const props = s.props();
    for (const side of ['Right', 'Bottom', 'Left', 'Start', 'End', 'Horizontal', 'Vertical']) {
      assert.equal(`padding${side}` in props, false, side);
    }
  });

  it('leaves the longhand under a shorthand of several values, which native does not take', () => {
    // Expanded, `4px 8px` would cover each side with its own part; whole, it is no side's value.
    const css = '.a { border-top-left-radius: 2px; border-top-color: green; padding-left: 2px }';
    const s = scene(css, 'a');
    s.style({ borderRadius: '4px 8px', borderColor: 'red blue', paddingInline: '4px 8px' });
    const props = s.props();
    assert.equal(props['borderTopLeftRadius'], 2);
    assert.equal(props['borderTopColor'], 'rgb(0, 128, 0)');
    assert.equal(props['paddingLeft'], 2);
    s.style({ borderRadius: '4px / 8px', borderColor: 'rgb(0 0 255)' });
    assert.equal(s.props()['borderTopLeftRadius'], 2, 'nor an elliptical radius');
    assert.equal(s.props()['borderTopColor'], 'rgb(0 0 255)', 'one value with spaces covers it');
  });

  it('gives a longhand two shorthands cover the one native reads, in either order', () => {
    // React Native reads `paddingInline` over `paddingHorizontal` over `padding`, whatever order
    // they are written in, so the side a rule set takes the same value it would have without it.
    const css = '.a { padding-left: 2px; padding-top: 2px; border-top-color: green; top: 2px }';
    for (const order of [
      { padding: 20, paddingHorizontal: 10, paddingInline: 5, paddingVertical: 7, paddingBlock: 3 },
      { paddingBlock: 3, paddingVertical: 7, paddingInline: 5, paddingHorizontal: 10, padding: 20 },
    ]) {
      const s = scene(css, 'a');
      s.style({ ...order, borderBlockColor: 'blue', borderColor: 'red', insetBlock: 4, inset: 9 });
      const props = s.props();
      assert.equal(props['paddingLeft'], 5, 'paddingInline');
      assert.equal(props['paddingTop'], 3, 'paddingBlock');
      assert.equal(props['borderTopColor'], 'blue', 'borderBlockColor');
      assert.equal(props['top'], 4, 'insetBlock');
    }
    const s = scene(css, 'a');
    s.style({ paddingHorizontal: 10 });
    s.engine.setBoundStyle(s.node, 'padding', 'var(--p)');
    s.engine.setCustomProperty(s.node, '--p', '20px');
    assert.equal(s.props()['paddingLeft'], 10, 'and a bound one is ranked the same');
  });

  it('gives a longhand under an inline flex the part Yoga reads from flex alone', () => {
    // Yoga reads `flexGrow`, `flexShrink` and `flexBasis` over `flex`, so a class's `grow-0` would
    // keep an inline `flex: 1` from growing. Each takes what `flex` means without it.
    const s = scene('.a { flex-grow: 0; flex-shrink: 2; flex-basis: auto }', 'a');
    const read = () => {
      const props = s.props();
      return [props['flexGrow'], props['flexShrink'], props['flexBasis']];
    };
    assert.deepEqual(read(), [0, 2, 'auto'], 'control');
    s.style({ flex: 1 });
    assert.deepEqual(read(), [1, 0, 0]);
    s.style({ flex: -1 });
    assert.deepEqual(read(), [0, 1, 'auto']);
    s.style({ flex: 0 });
    assert.deepEqual(read(), [0, 0, 'auto']);
    s.style({ flex: 'auto' });
    assert.deepEqual(read(), [0, 2, 'auto'], 'and covers nothing with a flex that is no number');
    s.style({ flex: Number.NaN });
    assert.deepEqual(read(), [0, 2, 'auto'], 'nor with one that is no finite number');
    s.style({ flex: Number.POSITIVE_INFINITY });
    assert.deepEqual(read(), [0, 2, 'auto']);
    s.style({ flex: 1, flexShrink: 3 });
    assert.deepEqual(read(), [1, 3, 0], 'and leaves one the element sets itself');
    s.style(null);
    assert.deepEqual(read(), [0, 2, 'auto'], 'and gives each back when it goes');
  });

  it('leaves flex longhands the stylesheet marks important under an inline flex', () => {
    const css =
      '.a { flex-grow: 4 !important; flex-shrink: 2 !important; flex-basis: auto !important }';
    const s = scene(css, 'a');
    s.style({ flex: 1 });
    const props = s.props();
    assert.deepEqual([props['flexGrow'], props['flexShrink'], props['flexBasis']], [4, 2, 'auto']);
  });

  it('leaves the longhand under an inline shorthand that is null, which sets nothing', () => {
    const s = scene('.a { padding-top: 4px }', 'a');
    s.style({ padding: null });
    assert.equal(s.props()['paddingTop'], 4);
    s.style({ padding: null, borderRadius: 10 });
    assert.equal(s.props()['paddingTop'], 4, 'beside one that is set');
  });

  it('covers a longhand from a class added after the inline shorthand', () => {
    const s = scene('.a { padding-top: 4px }', '');
    s.style({ padding: 10 });
    assert.equal(s.props()['padding'], 10);
    s.engine.addClass(s.node, 'a');
    assert.equal(s.props()['paddingTop'], 10);
    s.style({ padding: 12 });
    assert.equal(s.props()['paddingTop'], 12, 'and follows the shorthand changing');
    s.engine.removeClass(s.node, 'a');
    assert.equal(has(s.props(), 'paddingTop'), false, 'sent null once the class goes');
    assert.equal(s.props()['padding'], 12);
  });

  it('leaves a longhand the stylesheet marks important', () => {
    const s = scene(
      '.a { padding-top: 4px !important; padding-inline-start: 2px !important }',
      'a',
    );
    s.style({ padding: 10 });
    assert.equal(s.props()['paddingTop'], 4);
    assert.equal(s.props()['paddingStart'], 2);
    assert.equal(s.props()['padding'], 10, 'and the other sides are the inline one');
  });

  it('leaves an inline longhand beside it, as it was', () => {
    const s = scene('.a { padding-top: 4px; padding-left: 4px }', 'a');
    s.style({ padding: 10, paddingTop: 2 });
    assert.equal(s.props()['paddingTop'], 2);
    assert.equal(s.props()['paddingLeft'], 10);
    s.style({ paddingTop: 2, padding: 10 });
    assert.equal(s.props()['paddingTop'], 2);
    assert.equal(s.props()['padding'], 10);
  });

  it('leaves a longhand the element binds from a token beside it', () => {
    const s = scene('.a { --t: 2px }', 'a');
    s.style({ padding: 10 });
    s.engine.setBoundStyle(s.node, 'paddingTop', 'var(--t)');
    assert.equal(s.props()['paddingTop'], 2);
    assert.equal(s.props()['padding'], 10);
  });

  it('covers both forms of a side in a right-to-left layout, and leaves the other axis', () => {
    // Right to left the end is on the left: an inline margin across covers it as it does the left.
    const css = '.a { margin-inline-end: 4px; margin-right: 3px; margin-top: 2px }';
    const s = scene(css, 'a', 'rtl');
    assert.equal(s.props()['marginEnd'], 4, 'control');
    s.style({ marginHorizontal: 10 });
    const props = s.props();
    assert.equal(props['marginEnd'], 10);
    assert.equal(props['marginRight'], 10);
    assert.equal(props['marginTop'], 2);
    s.style({ marginVertical: 10 });
    assert.equal(s.props()['marginEnd'], 4);
    assert.equal(s.props()['marginRight'], 3);
    assert.equal(s.props()['marginTop'], 10);
  });

  it('covers the longhand under a bound shorthand from a token, and gives it back', () => {
    const s = scene('.a { --p: 10px; padding-top: 4px }', 'a');
    s.engine.setBoundStyle(s.node, 'padding', 'var(--p)');
    assert.equal(s.props()['padding'], 10);
    assert.equal(s.props()['paddingTop'], 10);
    s.engine.setBoundStyle(s.node, 'padding', null);
    assert.equal(s.props()['paddingTop'], 4);
    assert.equal(has(s.props(), 'padding'), false, 'sent null');
  });

  it('takes the longhand out under a bound shorthand whose token is unset', () => {
    // An inline `padding: var(--unset)` is padding at its initial value on every side.
    const s = scene('.a { padding-top: 4px }', 'a');
    assert.equal(
      s.props()['paddingTop'],
      4,
      'committed first, so the side has a value to take out',
    );
    s.engine.setBoundStyle(s.node, 'padding', 'var(--unset)');
    assert.equal(has(s.props(), 'paddingTop'), false, 'sent null');
    assert.equal(has(s.props(), 'padding'), false);
  });

  it('eases a longhand a rule transitions to the inline shorthand, and back', () => {
    let now = 1000;
    const fabric = createFakeFabric();
    const css = '.a { padding-top: 4px; transition: padding-top 100ms linear }';
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(css, 'app.css') as never,
      now: () => now,
    });
    const node = engine.createElement('view');
    engine.setClasses(node, 'a');
    engine.appendChild(engine.root, node);
    const at = (ms: number) => {
      now += ms;
      engine.advanceAnimations();
      engine.commit();
      return fabric.committed[0]!.props['paddingTop'];
    };
    assert.equal(at(0), 4);
    engine.setProp(node, 'style', { padding: 10 });
    assert.equal(at(0), 4);
    assert.equal(at(50), 7);
    assert.equal(at(100), 10);
    engine.setProp(node, 'style', null);
    assert.equal(at(0), 10);
    assert.equal(at(50), 7);
    assert.equal(at(100), 4);
  });
});

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

describe('a shorthand bound in a template over a longhand from its stylesheet', () => {
  it('wins on every side, and gives the side back when the binding goes', async () => {
    const file = path.join(import.meta.dirname, 'css-inline-shorthand-bound.fixture.ts');
    const mod = await compileSource(
      `
import { Component, signal } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-bound',
  imports: [View],
  template: '<view nativeID="box" class="pt" [style.padding.px]="pad()" [style.borderColor]="colour()"></view>',
  styles: '.pt { padding-top: 4px; border-top-color: red }',
})
export class Bound {
  readonly pad = signal<number | null>(10);
  readonly colour = signal<string | null>('rgb(0, 0, 255)');
}
`,
      file,
      file.replace(/\.ts$/, '.generated.ts'),
    );
    type Bound = {
      pad: { set(value: number | null): void };
      colour: { set(value: string | null): void };
    };
    const { fabric, instance } = await render(mod['Bound'] as Type<Bound>);
    const box = () => flatten(fabric.committed).find((one) => one.props['nativeID'] === 'box')!;
    const keys = ['padding', 'paddingTop', 'borderColor', 'borderTopColor'];
    const read = () => Object.fromEntries(keys.map((key) => [key, box().props[key] ?? null]));
    assert.deepEqual(read(), {
      padding: 10,
      paddingTop: 10,
      borderColor: 'rgb(0, 0, 255)',
      borderTopColor: 'rgb(0, 0, 255)',
    });

    instance.pad.set(null);
    instance.colour.set(null);
    await settle();
    assert.deepEqual(read(), {
      padding: null,
      paddingTop: 4,
      borderColor: null,
      borderTopColor: 'rgb(255, 0, 0)',
    });

    instance.pad.set(12);
    await settle();
    assert.equal(box().props['paddingTop'], 12, 'and covers it again as the binding comes back');
    assert.equal(box().props['padding'], 12);
  });
});
