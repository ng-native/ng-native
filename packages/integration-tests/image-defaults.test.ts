/**
 * An image clips to its own corners, as React Native's does: `Image.ios.js` gives the native view
 * `overflow: 'hidden'` as a base style. Without it a border radius rounds the view and not the
 * picture, which stays square.
 */
import type { Type } from '@angular/core';
import { cleanup, render, screen, type FakeFabricNode, compileCss } from '@ng-native/testing';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { compileFixture } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

describe('an image', () => {
  let Host: Type<unknown>;

  before(async () => {
    const mod = await compileFixture('fixtures/rounded-image.ts');
    Host = mod['RoundedImage'] as Type<unknown>;
  });

  it('clips to its own rounded corners', async () => {
    await render(Host);
    const photo = screen.getByTestId('photo');
    assert.equal(photo.props['overflow'], 'hidden');
    cleanup();
  });

  it('asks native for load events once one is listened for', async () => {
    const mod = await compileFixture('fixtures/rounded-image.ts');
    await render(mod['ListenedImage'] as Type<unknown>);
    // `Image.android.js` sets this alongside any load handler; without it Android's image view
    // never emits load, loadStart, loadEnd or error, and the handler silently never runs.
    assert.equal(screen.getByTestId('listened').props['shouldNotifyLoadEvents'], true);
    assert.equal(screen.getByTestId('quiet').props['shouldNotifyLoadEvents'], undefined);
    cleanup();
  });
});

/**
 * A source that knows its own size gives the image a box, the way an HTML image's natural size
 * does: only where the author said nothing. A class, a component rule or a bound style all win,
 * and one dimension on its own takes the other from the picture's proportions.
 */
describe("an image's intrinsic size", () => {
  let Host: Type<unknown>;
  let size: (id: string) => Record<string, unknown>;

  before(async () => {
    const mod = await compileFixture('fixtures/intrinsic-image.ts');
    Host = mod['IntrinsicImage'] as Type<unknown>;
    await render(Host, {
      globalStyles: compileCss('.global-size { width: 32px; height: 32px }', 'global'),
    });
    size = (id) => {
      const { width, height, aspectRatio } = screen.getByTestId(id).props;
      return { width, height, aspectRatio };
    };
  });

  it('is the box when nothing else sizes the image', () => {
    assert.deepEqual(size('bare'), { width: 600, height: 300, aspectRatio: undefined });
  });

  it('gives way to a class from the component stylesheet', () => {
    assert.deepEqual(size('classed'), { width: 44, height: 44, aspectRatio: undefined });
  });

  it('gives way to a class from the global stylesheet, where Tailwind lands', () => {
    assert.deepEqual(size('global'), { width: 32, height: 32, aspectRatio: undefined });
  });

  it('gives way to a bound style', () => {
    assert.deepEqual(size('bound'), { width: 120, height: 90, aspectRatio: undefined });
  });

  it("keeps the picture's proportions when a rule sets only the width", () => {
    assert.deepEqual(size('width-rule'), { width: 44, height: undefined, aspectRatio: 2 });
  });

  it("keeps the picture's proportions when a rule sets only the height", () => {
    assert.deepEqual(size('height-rule'), { width: undefined, height: 50, aspectRatio: 2 });
  });

  it("keeps the picture's proportions when a binding sets only the width", () => {
    assert.deepEqual(size('bound-width'), { width: 120, height: undefined, aspectRatio: 2 });
  });

  it("lets the author's own aspect ratio win over the picture's", () => {
    assert.deepEqual(size('own-ratio'), { width: 44, height: undefined, aspectRatio: 1 });
  });

  it('leaves an image whose source has no size to its layout', () => {
    assert.deepEqual(size('uri-only'), {
      width: undefined,
      height: undefined,
      aspectRatio: undefined,
    });
    cleanup();
  });
});

describe('an image background', () => {
  it("fills its box rather than taking the picture's own size", async () => {
    // RN's ImageBackground gives its image the outer style's size, and a class-sized background
    // has none in its style. Absolutely placed with no size of its own, the image would otherwise
    // fall back to the picture's 600 by 300 and overhang the 320 by 160 box.
    const mod = await compileFixture('fixtures/intrinsic-image.ts');
    const { fabric } = await render(mod['IntrinsicBackground'] as Type<unknown>);
    const image = flatten(fabric.committed).find((node) => node.viewName === 'Image');
    assert.equal(image?.props['width'], '100%');
    assert.equal(image?.props['height'], '100%');
    cleanup();
  });
});
