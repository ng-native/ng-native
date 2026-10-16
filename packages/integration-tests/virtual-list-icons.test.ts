/**
 * A row a windowed list parks is out of reach, `pointer-events: none`, which an icon inside it
 * inherits. Reused, the row gives the value up, and react-native-svg's Android root reads the
 * `null` that clears a prop as a string and stops the app (#884).
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import {
  cleanup,
  fireEvent,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

const isIcon = (node: FakeFabricNode) => node.viewName.startsWith('RNSVGSvgView');

/** Every `pointerEvents` an icon's root view is created or cloned with, in order. */
function sentToIcons(fabric: FakeFabric): unknown[] {
  const sent: unknown[] = [];
  const record = <N>(node: N, props: object): N => {
    const view = node as FakeFabricNode;
    if (isIcon(view) && 'pointerEvents' in props) {
      sent.push((props as Record<string, unknown>)['pointerEvents']);
    }
    return node;
  };
  const create = fabric.createNode.bind(fabric);
  const withProps = fabric.cloneNodeWithNewProps.bind(fabric);
  const withBoth = fabric.cloneNodeWithNewChildrenAndProps.bind(fabric);
  fabric.createNode = (...args) => record(create(...args), args[3] as object);
  fabric.cloneNodeWithNewProps = (node, props) => record(withProps(node, props), props);
  fabric.cloneNodeWithNewChildrenAndProps = (node, props) => record(withBoth(node, props), props);
  return sent;
}

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/virtual.ts');
});

it('clears pointerEvents to auto on an icon a reused row gives back', async () => {
  const { fabric } = await render(mod['VirtualIcons'] as Type<unknown>);
  const host = flatten(fabric.committed).find((node) => node.viewName === 'ScrollView')!;
  await fireEvent(host, 'layout', { layout: { height: 400 } });
  const sent = sentToIcons(fabric);

  for (const y of [400, 1200, 2400, 1600, 3200, 0, 4000]) {
    await fireEvent.scroll(host, { contentOffset: { y } });
  }

  assert.ok(sent.includes('none'), 'a parked row hands its icon none');
  assert.ok(sent.includes('auto'), 'and a reused one gives it back');
  assert.ok(!sent.includes(null), `pointerEvents sent to icons: ${JSON.stringify(sent)}`);
});

it('clears to auto a pointerEvents a binding sets to null', async () => {
  const { componentRef, fabric } = await render(mod['BoundTouchIcon'] as Type<unknown>);
  const icon = () => flatten(fabric.committed).find(isIcon)!;
  assert.equal(icon().props['pointerEvents'], 'none');
  (componentRef.instance as { touches: WritableSignal<string | null> }).touches.set(null);
  await settle();
  assert.equal(icon().props['pointerEvents'], 'auto');
});
