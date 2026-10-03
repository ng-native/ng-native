/**
 * A boolean prop written as an attribute. Angular hands an attribute over as text, and Android
 * checks a prop's type: `focusable="false"` reaching a view as the string `'false'` is
 * `java.lang.String cannot be cast to java.lang.Boolean` at the first commit.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { mount } from '@ng-native/platform';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { createRequire } from 'node:module';
import { Engine } from '@ng-native/fabric';
import { compileFixture } from './compile.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

describe('a boolean prop written as an attribute', () => {
  let props: (id: string) => Record<string, unknown>;

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/boolean-attributes.ts', import.meta.url)),
    );
    const fabric = createFakeFabric();
    mount(1, mod['BooleanAttributesFixture'] as Type<unknown>, fabric);
    const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
      nodes.flatMap((node) => [node, ...all(node.children)]);
    // A `<view>` commits its `id` as `nativeID`; an element nothing claims keeps `id`.
    props = (id) =>
      all(fabric.committed).find(
        (node) => node.props['id'] === id || node.props['nativeID'] === id,
      )!.props;
  });

  it("is false for 'false', on an element no component takes it as an input for", () => {
    const off = props('off');
    assert.equal(off['focusable'], false);
    assert.equal(off['accessible'], false);
    assert.equal(off['collapsable'], false);
    assert.equal(off['opacity'], 0.5, 'and still "false" to the attribute selector');
    assert.equal(props('on')['opacity'], undefined);
  });

  it('commits a prop bound with attr. on a component host, and none for null', () => {
    const bound = props('bound');
    assert.equal(bound['testID'], 'row-7');
    assert.equal('accessibilityLabel' in bound, false);
  });

  it("is true for 'true', and for the attribute alone", () => {
    const on = props('on');
    assert.equal(on['focusable'], true);
    assert.equal(on['accessible'], true);
    assert.equal(on['collapsable'], true);
  });

  it('covers the flags native reads for an event it should send', () => {
    const events = props('events');
    assert.equal(events['onLayout'], false);
    assert.equal(events['onAccessibilityTap'], true);
  });

  it('leaves a string prop the text it was given', () => {
    const other = props('other');
    assert.equal(other['testID'], 'false');
    assert.equal(other['nativeID'], 'true');
  });

  it('still takes a typed input on a component that declares one', () => {
    assert.equal(props('typed')['focusable'], false);
  });

  it('is still its text to a stylesheet, as an attribute selector reads it in a browser', () => {
    const sheet = compileCss(
      '[focusable="false"] { opacity: 0.5 } [focusable="true"] { opacity: 0.25 }',
      'boolean-attributes',
      {},
    );
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const node = engine.createElement('view', sheet);
    engine.setProp(node, 'focusable', 'false');
    engine.appendChild(engine.root, node);
    engine.commit();
    assert.equal(fabric.committed[0]!.props['focusable'], false, 'a boolean to native');
    assert.equal(fabric.committed[0]!.props['opacity'], 0.5, 'and "false" to the selector');
  });
});
