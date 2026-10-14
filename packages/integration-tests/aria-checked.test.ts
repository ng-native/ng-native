/** `aria-checked` written as an attribute is text, and native takes a boolean or `mixed`. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { render, type FakeFabricNode } from '@ng-native/testing';
import { compileSource } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

describe('aria-checked written as an attribute', () => {
  it('reaches native as a boolean, or mixed', async () => {
    const file = path.join(import.meta.dirname, 'aria-checked.fixture.ts');
    const mod = await compileSource(
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-checked',
  imports: [View],
  template:
    '<view aria-checked="true"></view><view aria-checked="false"></view><view aria-checked="mixed"></view>',
})
export class Checked {}
`,
      file,
      file.replace(/\.ts$/, '.generated.ts'),
    );
    const { fabric } = await render(mod['Checked'] as Type<unknown>);
    const states = flatten(fabric.committed)
      .map((node) => node.props['accessibilityState'])
      .filter((state) => state !== undefined);
    assert.deepEqual(states, [{ checked: true }, { checked: false }, { checked: 'mixed' }]);
  });
});
