/**
 * React Native's axis shorthands written in a stylesheet: `padding-horizontal`,
 * `padding-vertical`, `margin-horizontal` and `margin-vertical`.
 *
 * Bound or inline, `paddingHorizontal` reaches native as React Native's own prop. In a sheet the
 * same name is one value on both sides of an axis, which is what CSS spells `padding-inline` or
 * `padding-block` with one value, so it compiles as that does: to the edges, settled by the
 * cascade against the other declarations of those edges, whichever is later or stronger winning.
 * Chrome has none of these properties, so there is no oracle row for them.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine, type EngineNode } from '@ng-native/fabric';
import {
  cleanup,
  compileCss,
  createFakeFabric,
  render,
  settle,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileSource } from './compile.ts';

after(cleanup);

const BASE = { width: 400, height: 800, colorScheme: 'light' as const };

/** The four shorthands, each with the CSS property that one value of it is. */
const AXES = [
  ['padding-horizontal', 'padding-inline'],
  ['padding-vertical', 'padding-block'],
  ['margin-horizontal', 'margin-inline'],
  ['margin-vertical', 'margin-block'],
] as const;

/** A sheet compiled, with each declaration it drops. */
function compiled(css: string) {
  const dropped: string[] = [];
  const sheet = compileCss(css, 'app.css', { onUnsupported: (message) => dropped.push(message) });
  return { sheet, dropped };
}

/** One view with `classes` under `css`, and what it last committed. */
function scene(css: string, classes: string, direction?: 'ltr' | 'rtl') {
  const { sheet, dropped } = compiled(css);
  assert.deepEqual(dropped, [], 'nothing dropped');
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: sheet as never,
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

describe('an axis shorthand in a stylesheet', () => {
  const values = [
    '12px',
    '0',
    '10%',
    '1.5em',
    'calc(10% + 4px)',
    'var(--gap)',
    'calc(var(--gap) * 2)',
    'env(safe-area-inset-left, 8px)',
    'max(env(safe-area-inset-top), 8px)',
    'inherit',
  ];
  for (const [axis, css] of AXES) {
    for (const value of [...values, ...(axis.startsWith('margin') ? ['auto', '-4px'] : [])]) {
      it(`compiles ${axis}: ${value} as ${css}: ${value}`, () => {
        const ours = compiled(`.a { ${axis}: ${value} }`);
        const theirs = compiled(`.a { ${css}: ${value} }`);
        // A CSS-wide keyword is dropped from both, as the cascade drops it from any property.
        const drops = value === 'inherit' ? 1 : 0;
        assert.equal(theirs.dropped.length, drops, 'control');
        assert.equal(ours.dropped.length, drops, ours.dropped.join('\n'));
        for (const message of ours.dropped) assert.match(message, /CSS-wide keyword/);
        assert.deepEqual(ours.sheet, theirs.sheet);
      });
    }
  }

  it('lands on both edges of its axis, and sends no prop of its own', () => {
    const css =
      '.a { padding-horizontal: 12px; padding-vertical: 6px; margin-horizontal: 4px; margin-vertical: 2px }';
    const props = scene(css, 'a').props();
    assert.equal(props['paddingLeft'], 12);
    assert.equal(props['paddingRight'], 12);
    assert.equal(props['paddingTop'], 6);
    assert.equal(props['paddingBottom'], 6);
    assert.equal(props['marginLeft'], 4);
    assert.equal(props['marginRight'], 4);
    assert.equal(props['marginTop'], 2);
    assert.equal(props['marginBottom'], 2);
    for (const key of ['paddingHorizontal', 'paddingVertical', 'marginHorizontal']) {
      assert.equal(key in props, false, key);
    }
  });

  it('takes a token on device', () => {
    const props = scene(':root { --gap: 8px } .a { padding-horizontal: var(--gap) }', 'a').props();
    assert.equal(props['paddingLeft'], 8);
    assert.equal(props['paddingRight'], 8);
  });

  it('keeps an important one over a later rule', () => {
    const css = '.a { padding-vertical: 6px !important } .b { padding-top: 1px }';
    const props = scene(css, 'a b').props();
    assert.equal(props['paddingTop'], 6);
    assert.equal(props['paddingBottom'], 6);
  });

  it('refuses two values, which React Native gives no axis shorthand, and keeps the rule', () => {
    const { sheet, dropped } = compiled('.a { padding-horizontal: 1px 2px; padding-top: 3px }');
    assert.equal(dropped.length, 1);
    assert.match(dropped[0]!, /'padding-horizontal' takes one value/);
    assert.match(dropped[0]!, /padding-inline/);
    assert.deepEqual(sheet.rules[0]!.declarations, { paddingTop: 3 });
  });

  it('plays in a keyframe as the CSS spelling does', () => {
    const sheet = (property: string) =>
      compiled(`@keyframes k { from { ${property}: 0 } to { ${property}: 10px } }`);
    const ours = sheet('margin-vertical');
    assert.deepEqual(ours.dropped, []);
    assert.deepEqual(ours.sheet, sheet('margin-block').sheet);
  });

  it('eases both edges where a transition names it', () => {
    const ours = compiled('.a { transition: padding-horizontal 100ms linear }');
    assert.deepEqual(ours.dropped, []);
    const transition = ours.sheet.rules[0]!.declarations['$transition'] as Record<string, unknown>;
    assert.deepEqual(Object.keys(transition).sort(), ['paddingLeft', 'paddingRight']);
  });
});

describe('an axis shorthand against an edge of its axis', () => {
  const SHORT = '.h { padding-horizontal: 12px }';

  it('loses the edge a later rule sets, and keeps the other', () => {
    const props = scene(`${SHORT} .l { padding-left: 4px }`, 'h l').props();
    assert.equal(props['paddingLeft'], 4);
    assert.equal(props['paddingRight'], 12);
  });

  it('wins over an edge an earlier rule sets', () => {
    const props = scene(`.l { padding-left: 4px } ${SHORT}`, 'h l').props();
    assert.equal(props['paddingLeft'], 12);
    assert.equal(props['paddingRight'], 12);
  });

  it('is settled by the order a rule writes them in', () => {
    const later = scene('.a { padding-horizontal: 12px; padding-left: 4px }', 'a').props();
    assert.equal(later['paddingLeft'], 4);
    assert.equal(later['paddingRight'], 12);
    const earlier = scene('.a { padding-left: 4px; padding-horizontal: 12px }', 'a').props();
    assert.equal(earlier['paddingLeft'], 12);
  });

  it('loses a later logical edge, which Yoga reads by the direction', () => {
    const css = `${SHORT} .s { padding-inline-start: 4px }`;
    const ltr = scene(css, 'h s').props();
    assert.equal(ltr['paddingStart'], 4);
    assert.equal(has(ltr, 'paddingLeft'), false, 'the start is the left');
    assert.equal(ltr['paddingRight'], 12);
    const rtl = scene(css, 'h s', 'rtl').props();
    assert.equal(rtl['paddingStart'], 4);
    assert.equal(has(rtl, 'paddingRight'), false, 'the start is the right');
    assert.equal(rtl['paddingLeft'], 12);
  });

  it('wins over an earlier logical edge, in either direction', () => {
    const css = `.s { padding-inline-start: 4px } ${SHORT}`;
    for (const direction of ['ltr', 'rtl'] as const) {
      const props = scene(css, 'h s', direction).props();
      assert.equal(has(props, 'paddingStart'), false, direction);
      assert.equal(props['paddingLeft'], 12, direction);
      assert.equal(props['paddingRight'], 12, direction);
    }
  });

  it('is settled against a logical edge by the order a rule writes them in', () => {
    const later = scene('.a { padding-horizontal: 12px; padding-inline-start: 4px }', 'a').props();
    assert.equal(later['paddingStart'], 4);
    assert.equal(has(later, 'paddingLeft'), false);
    assert.equal(later['paddingRight'], 12);
    const earlier = scene(
      '.a { padding-inline-start: 4px; padding-horizontal: 12px }',
      'a',
    ).props();
    assert.equal(has(earlier, 'paddingStart'), false);
    assert.equal(earlier['paddingLeft'], 12);
  });

  it('is overridden by a later padding and overrides an earlier one', () => {
    const later = scene(`${SHORT} .p { padding: 2px }`, 'h p').props();
    assert.equal(later['paddingLeft'], 2);
    const earlier = scene(`.p { padding: 2px } ${SHORT}`, 'h p').props();
    assert.equal(earlier['paddingLeft'], 12);
    assert.equal(earlier['paddingTop'], 2);
  });
});

describe('an axis shorthand from a stylesheet and the element’s own style', () => {
  it('gives way to an inline axis shorthand, and comes back when it goes', () => {
    const s = scene('.h { padding-horizontal: 12px }', 'h');
    s.style({ paddingHorizontal: 20 });
    const covered = s.props();
    assert.equal(covered['paddingHorizontal'], 20);
    assert.equal(covered['paddingLeft'], 20);
    assert.equal(covered['paddingRight'], 20);
    s.style(null);
    const back = s.props();
    assert.equal(has(back, 'paddingHorizontal'), false, 'sent null');
    assert.equal(back['paddingLeft'], 12);
  });

  it('gives way to an inline edge on that edge alone', () => {
    const s = scene('.h { padding-horizontal: 12px }', 'h');
    s.style({ paddingLeft: 3 });
    const props = s.props();
    assert.equal(props['paddingLeft'], 3);
    assert.equal(props['paddingRight'], 12);
  });

  it('sends null for both edges when the class goes', () => {
    const s = scene('.h { margin-vertical: 6px }', 'h');
    assert.equal(s.props()['marginTop'], 6);
    s.engine.setClasses(s.node, '');
    const props = s.props();
    assert.equal('marginTop' in props && props['marginTop'], null);
    assert.equal('marginBottom' in props && props['marginBottom'], null);
  });
});

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

describe('an axis shorthand in a component stylesheet', () => {
  it('pads the box, under a binding of the same shorthand and without it', async () => {
    const file = path.join(import.meta.dirname, 'css-axis-shorthands.fixture.ts');
    const mod = await compileSource(
      `
import { Component, signal } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-axis',
  imports: [View],
  template: '<view nativeID="box" class="a" [style.paddingHorizontal]="pad()"></view>',
  styles: '.a { padding-horizontal: 12px; padding-vertical: 6px; }',
})
export class Axis {
  readonly pad = signal<number | null>(null);
}
`,
      file,
      file.replace(/\.ts$/, '.generated.ts'),
    );
    type Axis = { pad: { set(value: number | null): void } };
    const { fabric, instance } = await render(mod['Axis'] as Type<Axis>);
    const box = () => flatten(fabric.committed).find((one) => one.props['nativeID'] === 'box')!;
    const keys = ['paddingHorizontal', 'paddingLeft', 'paddingRight', 'paddingTop'];
    const read = () => Object.fromEntries(keys.map((key) => [key, box().props[key] ?? null]));
    assert.deepEqual(read(), {
      paddingHorizontal: null,
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 6,
    });

    instance.pad.set(20);
    await settle();
    assert.deepEqual(read(), {
      paddingHorizontal: 20,
      paddingLeft: 20,
      paddingRight: 20,
      paddingTop: 6,
    });

    instance.pad.set(null);
    await settle();
    assert.deepEqual(read(), {
      paddingHorizontal: null,
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 6,
    });
  });
});
