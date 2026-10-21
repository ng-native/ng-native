import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createFakeFabric, type FakeFabricNode } from './test-utils.ts';

it('keeps a closed modal dismissed when a later clone leaves visible undefined, as JSI drops it', async () => {
  const fabric = createFakeFabric();
  const heard: string[] = [];
  fabric.registerEventHandler!((_target: unknown, type: string) => heard.push(type));
  const shown = fabric.createNode(
    1,
    'ModalHostView',
    1,
    { visible: true },
    {},
  ) as unknown as FakeFabricNode;
  const set = (node: FakeFabricNode) => {
    const children = fabric.createChildSet(1);
    fabric.appendChildToSet(children, node as never);
    fabric.completeRoot(1, children);
  };
  set(shown);
  const closed = fabric.cloneNodeWithNewProps(shown as never, {
    visible: false,
  }) as unknown as FakeFabricNode;
  set(closed);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(heard, ['topDismiss']);
  const again = fabric.cloneNodeWithNewProps(closed as never, {
    visible: undefined,
  }) as unknown as FakeFabricNode;
  set(again);
  fabric.emit(again, 'topDismiss');
  assert.deepEqual(heard, ['topDismiss'], 'the one dismissal was not delivered twice');
});
