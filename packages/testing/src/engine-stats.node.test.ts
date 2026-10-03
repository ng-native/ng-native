/**
 * How much of a tree an interaction commits again, read from the engine's own counters: the
 * example on the testing API page.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Component, signal } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';
import { Engine } from '@ng-native/fabric';
import { cleanup, render, screen, userEvent } from '@ng-native/testing';

afterEach(cleanup);

@Component({
  selector: 'x-rows',
  imports: [Pressable, Text, View],
  template: `
    @for (row of rows; track row) {
      <view
        ><text>Row {{ row }}</text></view
      >
    }
    <pressable (press)="count.set(count() + 1)"
      ><text>Tapped {{ count() }}</text></pressable
    >
  `,
})
class Rows {
  readonly rows = Array.from({ length: 20 }, (_, index) => index);
  readonly count = signal(0);
}

test('a press commits the text that changed and what holds it, and creates nothing', async () => {
  const { componentRef, fabric } = await render(Rows);
  const { stats } = componentRef.injector.get(Engine);
  const before = { ...stats };
  fabric.reset();

  await userEvent.press(screen.getByText('Tapped 0'));

  assert.equal(stats.createdNodes - before.createdNodes, 0);
  const cloned = stats.clonedNodes - before.clonedNodes;
  assert.ok(cloned > 0 && cloned < 10, `${cloned} of the tree's nodes, not its twenty rows`);
  assert.equal(fabric.calls.createNode, 0, 'which the fake counted too, from its reset');
  assert.equal((fabric.calls as { reset?: unknown }).reset, undefined);
});

test('a node held from before a change keeps the props it was found with', async () => {
  await render(Rows);
  const held = screen.getByText('Tapped 0').parent!;
  await userEvent.press(held);
  assert.equal(screen.queryByText('Tapped 0'), null);
  assert.ok(screen.getByText('Tapped 1'));
  const text = (node: typeof held): unknown => node.children[0]?.children[0]?.props['text'];
  assert.equal(text(held), 'Tapped 0', 'the commit it came from');
  assert.equal(text(screen.getByText('Tapped 1').parent!), 'Tapped 1');
});
