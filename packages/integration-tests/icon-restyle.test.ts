/**
 * A page of icons is a page of shapes: an outline set's icon is a view and two or three shapes
 * under it. Native paints a `currentColor` shape from the drawing it is in, so a colour or a size
 * bound on the icon has the icon's own view to change, and none of its shapes. Styling each shape
 * again under it made a list of a thousand icons take twice as long to recolour or resize.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { cleanup, render, settle, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { resetStyleStats, styleStats } from '../fabric/src/css.ts';
import { compileFixture } from './compile.ts';

interface Host {
  size: WritableSignal<number>;
  colour: WritableSignal<string>;
  weight: WritableSignal<number | undefined>;
  swapped: WritableSignal<string>;
}

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

const icon = (fabric: FakeFabric, id: string) =>
  flatten(fabric.committed).find((node) => node.props['nativeID'] === id)!;

/** The views cloned while `change` is committed, by name. */
async function clonedBy(fabric: FakeFabric, change: () => void): Promise<string[]> {
  const cloned: string[] = [];
  for (const name of [
    'cloneNodeWithNewProps',
    'cloneNodeWithNewChildren',
    'cloneNodeWithNewChildrenAndProps',
  ] as const) {
    const clone = fabric[name].bind(fabric) as (...args: unknown[]) => FakeFabricNode;
    fabric[name] = ((node: FakeFabricNode, ...rest: unknown[]) => {
      cloned.push(node.viewName);
      return clone(node, ...rest);
    }) as never;
  }
  change();
  await settle();
  return cloned;
}

let Fixture: Type<Host>;
before(async () => {
  Fixture = (await compileFixture('fixtures/icon-restyle.ts'))['IconRestyle'] as Type<Host>;
});
afterEach(cleanup);

describe("an icon's shapes, as the icon changes", () => {
  it("re-commits the icon's own view for a colour, and none of its shapes", async () => {
    const { fabric, instance } = await render(Fixture);
    const cloned = await clonedBy(fabric, () => instance.colour.set('#0a84ff'));
    assert.deepEqual(
      cloned.filter((name) => name.startsWith('RNSVG')),
      ['RNSVGSvgView'],
    );
    const view = icon(fabric, 'outline');
    assert.equal(view.props['color'], '#0a84ff');
    for (const shape of flatten(view.children)) {
      assert.equal(shape.props['color'], undefined, 'native paints it from the drawing');
    }
  });

  it('styles none of its shapes again for a size', async () => {
    const { instance } = await render(Fixture);
    resetStyleStats();
    instance.size.set(32);
    await settle();
    assert.equal(styleStats.nodesResolved, 1, 'the icon alone');
  });
});

describe("an icon's root paint", () => {
  it('is each shape its own, with no group to carry it', async () => {
    const { fabric } = await render(Fixture);
    const view = icon(fabric, 'outline');
    assert.deepEqual(
      view.children.map((child) => child.viewName),
      ['RNSVGPath', 'RNSVGPath'],
    );
    const [first, second] = view.children as [FakeFabricNode, FakeFabricNode];
    assert.deepEqual(first.props['stroke'], { type: 2 });
    // `fill="none"`: named in the list and sent as nothing, which react-native-svg draws as none.
    assert.equal(first.props['fill'] ?? null, null);
    assert.equal(first.props['strokeWidth'], '1.5', "from the root's style");
    assert.equal(first.props['strokeLinecap'], 1);
    assert.deepEqual([...(first.props['propList'] as string[])].sort(), [
      'fill',
      'stroke',
      'strokeLinecap',
      'strokeWidth',
    ]);
    assert.equal(second.props['strokeWidth'], '3', "the shape's own over the root's style");
  });

  it('stays on a group where the group draws it differently, as an opacity over two shapes', async () => {
    const { fabric } = await render(Fixture);
    const [group] = icon(fabric, 'faded').children;
    assert.equal(group?.viewName, 'RNSVGGroup');
    assert.equal(group?.props['opacity'], 0.5);
    assert.deepEqual(
      group?.children.map((child) => child.viewName),
      ['RNSVGCircle', 'RNSVGCircle'],
    );
  });

  it('hands down only the paint in the root style, past a title that draws nothing', async () => {
    const { fabric } = await render(Fixture);
    const view = icon(fabric, 'titled');
    assert.deepEqual(
      view.children.map((child) => child.viewName),
      ['RNSVGRect'],
    );
    const [rect] = view.children as [FakeFabricNode];
    assert.deepEqual(rect.props['fill'], { type: 0, payload: 'red' });
    assert.notEqual(rect.props['width'], '24px', "the root's size is not the rect's");
    assert.notEqual(rect.props['height'], '24px');
  });
});

describe('an icon drawn again', () => {
  it('takes a new stroke width, where another icon drawing the same markup keeps its own', async () => {
    const { fabric, instance } = await render(Fixture);
    const widths = (id: string) =>
      icon(fabric, id).children.map((shape) => shape.props['strokeWidth']);
    assert.deepEqual(widths('swapped'), ['1.5', '3']);
    instance.weight.set(2);
    await settle();
    assert.deepEqual(widths('outline'), ['2', '3']);
    instance.swapped.set(`${instance.swapped()} `);
    await settle();
    assert.deepEqual(widths('swapped'), ['1.5', '3'], "not the other icon's width");
    instance.weight.set(undefined);
    await settle();
    assert.deepEqual(widths('outline'), ['1.5', '3']);
  });

  it('clears the viewBox when the markup it draws has none', async () => {
    const { fabric, instance } = await render(Fixture);
    assert.equal(icon(fabric, 'swapped').props['vbWidth'], 24);
    instance.swapped.set('<svg><path d="M1 1L2 2"/></svg>');
    await settle();
    const view = icon(fabric, 'swapped');
    assert.deepEqual(
      ['minX', 'minY', 'vbWidth', 'vbHeight', 'align', 'meetOrSlice'].map(
        (prop) => view.props[prop] ?? null,
      ),
      [null, null, null, null, null, null],
    );
    assert.equal(view.children.length, 1, 'and draws the new markup');
  });

  it("translates its colours with the app's own processColor, not one an earlier app cached", async () => {
    const fill = async (prefix: string) => {
      const { fabric } = await render(Fixture, {
        processColor: (value) => `${prefix}:${String(value)}`,
      });
      const [rect] = icon(fabric, 'titled').children as [FakeFabricNode];
      const paint = rect.props['fill'] as { payload: unknown };
      cleanup();
      return paint.payload;
    };
    assert.equal(await fill('first'), 'first:red');
    assert.equal(await fill('second'), 'second:red');
  });
});
