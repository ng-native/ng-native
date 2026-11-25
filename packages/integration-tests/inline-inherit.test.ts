/**
 * `inherit` written in an element's own style, `style="width: inherit"` or `[style.width]`: the
 * parent's value, as a stylesheet's `inherit` is, for the properties a stylesheet takes it for.
 * Any other is refused with a warning, where the word itself used to reach native.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { compileSource } from './compile.ts';

afterEach(cleanup);

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

async function scene() {
  const file = path.join(import.meta.dirname, 'inline-inherit.fixture.ts');
  const mod = await compileSource(
    `
import { Component, signal } from '@angular/core';
import { Text } from '../components/src/text.ts';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-inline-inherit',
  imports: [Text, View],
  template: \`
    <view class="framed">
      <view nativeID="attribute" style="width: inherit; border-top-width: inherit"></view>
      <view nativeID="bound" [style.width]="'inherit'"></view>
      <view nativeID="display" style="display: inherit"></view>
      <text nativeID="colour" style="color: inherit">a</text>
    </view>
  \`,
  styles: '.framed { width: 50px; border-top-width: 3px; color: rgb(1, 2, 3) }',
})
export class InlineInherit {}
`,
    file,
    file.replace(/\.ts$/, '.generated.ts'),
  );
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(' '));
  try {
    const { fabric } = await render(mod['InlineInherit'] as Type<unknown>, { dev: true });
    await settle();
    const props = (id: string) => {
      const node = flatten(fabric.committed).find((one) => one.props['nativeID'] === id)!;
      return { ...((node.props['style'] ?? {}) as Record<string, unknown>), ...node.props };
    };
    return { props, warnings };
  } finally {
    console.warn = original;
  }
}

describe("inherit in an element's own style", () => {
  it("is the parent's value, written in the attribute and bound", async () => {
    const { props } = await scene();
    assert.equal(props('attribute')['width'], 50);
    assert.equal(props('attribute')['borderTopWidth'], 3);
    assert.equal(props('bound')['width'], 50);
  });

  it("is the parent's colour", async () => {
    const { props } = await scene();
    assert.equal(props('colour')['color'], 'rgb(1, 2, 3)');
  });

  it('is refused with a warning where a stylesheet refuses it, and never reaches native', async () => {
    const { props, warnings } = await scene();
    assert.equal(props('display')['display'] ?? null, null);
    assert.match(warnings.join('\n'), /display/);
  });
});
