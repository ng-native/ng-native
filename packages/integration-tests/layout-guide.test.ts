/**
 * The "A component's host is a flex item" example on the Layout and views page, extracted and
 * compiled for real, then laid out with Yoga: a component's host is a view of its own, so the
 * scroll view inside it fills the screen only when the host has `flex: 1`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, type FakeFabricNode, type RenderOptions } from '@ng-native/testing';
import { compileSource } from './compile.ts';
import { layOutTree } from './layout.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const SCREEN = { width: 400, height: 800 };
const LINE = 20;

const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

function hostExample(markdown: string): string {
  const blocks = [...markdown.matchAll(/```ts\n([\s\S]*?)\n```/g)].map((match) => match[1]!);
  const block = blocks.find((source) => source.includes('export class CaseList'));
  assert.ok(block, 'no ts block declaring CaseList on the Layout and views page');
  return block;
}

describe("the Layout and views page's component host example, compiled and laid out", () => {
  let source: string;

  before(() => {
    source = hostExample(
      readFileSync(
        fileURLToPath(
          new URL(
            '../../apps/documentation/src/content/packages/components/layout.md',
            import.meta.url,
          ),
        ),
        'utf8',
      ),
    );
  });

  afterEach(() => cleanup());

  let compiled = 0;
  async function compile(code: string): Promise<Type<unknown>> {
    compiled += 1;
    const file = fileURLToPath(new URL(`./fixtures/layout-guide-${compiled}.ts`, import.meta.url));
    const out = file.replace(/\.ts$/, '.generated.ts');
    const mod = await compileSource(code, file, out);
    return mod['Cases'] as Type<unknown>;
  }

  /** The scroll view's height, with the screen's one line of text at a fixed height. */
  async function scrollViewHeight(
    code: string,
    options: RenderOptions<unknown> = {},
  ): Promise<number> {
    const { fabric } = await render(await compile(code), options);
    const sizes = layOutTree(fabric.committed, SCREEN, (node) =>
      node.viewName === 'Paragraph' ? { height: LINE } : undefined,
    );
    const scroll = flatten(fabric.committed).find((node) => node.viewName === 'ScrollView');
    assert.ok(scroll, 'no scroll view committed');
    return sizes.get(scroll)!.height;
  }

  const withoutHost = (code: string) => code.replace("  host: { style: 'flex: 1' },\n", '');

  it('fills the space under the header with the host binding the page shows', async () => {
    assert.equal(await scrollViewHeight(source), SCREEN.height - LINE);
  });

  it('gives the scroll view no height when the host has no flex', async () => {
    const bare = withoutHost(source);
    assert.notEqual(bare, source, 'the example no longer sets the host style');
    assert.equal(await scrollViewHeight(bare), 0);
  });

  it('commits the host as a plain view between the parent and the scroll view', async () => {
    const { fabric } = await render(await compile(source));
    const screen = fabric.committed[0]!.children[0]!;
    const host = screen.children[1]!;
    assert.equal(host.viewName, 'View');
    assert.equal(host.props['flex'], 1);
    assert.equal(host.children[0]!.viewName, 'ScrollView');
  });

  it('fills the same with :host in the component styles', async () => {
    const code = withoutHost(source).replace(
      '  styles: `\n    .list {',
      '  styles: `\n    :host {\n      flex: 1;\n    }\n    .list {',
    );
    assert.equal(await scrollViewHeight(code), SCREEN.height - LINE);
  });

  it('fills the same with a host class from the global sheet, as Tailwind gives', async () => {
    const code = withoutHost(source).replace(
      '  imports: [ScrollView, Text],\n',
      "  imports: [ScrollView, Text],\n  host: { class: 'flex-1' },\n",
    );
    const globalStyles = compileCss('.flex-1 { flex: 1; }', 'global');
    assert.equal(await scrollViewHeight(code, { globalStyles }), SCREEN.height - LINE);
  });

  it("does not style the host from a class in the component's own styles", async () => {
    const code = withoutHost(source)
      .replace(
        '  imports: [ScrollView, Text],\n',
        "  imports: [ScrollView, Text],\n  host: { class: 'fill' },\n",
      )
      .replace(
        '  styles: `\n    .list {',
        '  styles: `\n    .fill {\n      flex: 1;\n    }\n    .list {',
      );
    assert.equal(await scrollViewHeight(code), 0);
  });

  it('fills the screen from the root component with no host style', async () => {
    const { fabric } = await render(await compile(withoutHost(source)));
    const sizes = layOutTree(fabric.committed, SCREEN, (node) =>
      node.viewName === 'Paragraph' ? { height: LINE } : undefined,
    );
    assert.equal(sizes.get(fabric.committed[0]!.children[0]!)!.height, SCREEN.height);
  });
});
