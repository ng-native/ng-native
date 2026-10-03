/**
 * `fabric.render({ props: true })`, which prints what native was sent. A text field holds its text
 * as a prop, and is the one element whose other props a form test most wants to read.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeFabric } from '@ng-native/testing';

test('prints the props of a node that has text, after the text', () => {
  const fabric = createFakeFabric();
  const field = fabric.createNode(2, 'TextInput', 1, { text: 'ada', placeholder: 'Email' }, null);
  const raw = fabric.createNode(3, 'RawText', 1, { text: 'Hello' }, null);
  const set = fabric.createChildSet(1);
  fabric.appendChildToSet(set, field);
  fabric.appendChildToSet(set, raw);
  fabric.completeRoot(1, set);

  assert.equal(
    fabric.render({ props: true }),
    ['TextInput "ada" {"placeholder":"Email"}', 'RawText "Hello"'].join('\n'),
  );
  assert.equal(fabric.render(), ['TextInput "ada"', 'RawText "Hello"'].join('\n'));
});
