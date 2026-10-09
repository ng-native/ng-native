/**
 * `contentContainerClass` on `<scroll-view>`: classes for the view that holds the children,
 * matched by the global sheet and by the styles of the component the scroll view is written in,
 * as a class on any element of that template would be.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import type { StyleSheet } from '@ng-native/fabric';
import { cleanup, render, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(css: string, context: string, options?: object): StyleSheet;
};

type Fixture = {
  classes: { set(value: string): void };
  late: { set(value: string | undefined): void };
  behavior: { set(value: 'position' | 'padding'): void };
};

let ContentContainerClass: Type<Fixture>;

before(async () => {
  const mod = await compileFixture('fixtures/content-container-class.ts');
  ContentContainerClass = mod['ContentContainerClass'] as Type<Fixture>;
});

after(cleanup);

const globalStyles = () => compileCss('.global { padding-top: 16px; row-gap: 4px }', 'global');

/** The content view: the scroll view's own child that holds the children. */
const content = (scroll: FakeFabricNode) => scroll.children.at(-1)!;

describe('contentContainerClass on a scroll view', () => {
  it('styles the content view from the global sheet and the component that wrote it', async () => {
    const { getByTestId } = await render(ContentContainerClass, { globalStyles: globalStyles() });
    const props = content(getByTestId('scroll')).props;
    assert.equal(props['paddingTop'], 16, 'the global sheet');
    assert.equal(props['rowGap'], 4);
    assert.equal(props['paddingLeft'], 24, "the writing component's own styles");
    assert.equal(props['columnGap'], 8);
    assert.equal(getByTestId('scroll').props['paddingLeft'], undefined, 'not the scroll view');
    cleanup();
  });

  it('follows a change to the classes', async () => {
    const { instance, getByTestId, rerender } = await render(ContentContainerClass, {
      globalStyles: globalStyles(),
    });
    instance.classes.set('global');
    await rerender();
    const props = content(getByTestId('scroll')).props;
    assert.equal(props['paddingTop'], 16);
    assert.equal(props['paddingLeft'] ?? null, null, 'own dropped');
    cleanup();
  });

  it('leaves the content view out of the component styles until it has a class', async () => {
    const { instance, getByTestId, rerender } = await render(ContentContainerClass);
    assert.equal(
      content(getByTestId('late')).props['opacity'] ?? null,
      null,
      'no class, no view {}',
    );
    instance.late.set('own');
    await rerender();
    const props = content(getByTestId('late')).props;
    assert.equal(props['paddingLeft'], 24, 'a class set later');
    assert.equal(props['opacity'], 0.5, 'and from then on it is styled as written there');

    instance.late.set(undefined);
    await rerender();
    const cleared = content(getByTestId('late')).props;
    assert.equal(cleared['paddingLeft'] ?? null, null, 'the class removed');
    assert.equal(cleared['opacity'] ?? null, null, 'and the component styles with it');
    cleanup();
  });

  it('sits under contentContainerStyle, and keeps the horizontal row', async () => {
    const { getByTestId } = await render(ContentContainerClass, { globalStyles: globalStyles() });
    const props = content(getByTestId('both')).props;
    assert.equal(props['paddingLeft'], 1, 'the style wins over the class');
    assert.equal(props['columnGap'], 8);
    assert.equal(props['flexDirection'], 'row');
    cleanup();
  });
});

describe('contentContainerClass on a keyboard-avoiding view', () => {
  /** The view `position` moves, the only child the component adds. */
  const inner = (avoiding: FakeFabricNode) => avoiding.children[0]!;

  it('styles the view position moves, and only while it has a class', async () => {
    const { instance, getByTestId, rerender } = await render(ContentContainerClass, {
      globalStyles: globalStyles(),
    });
    assert.equal(inner(getByTestId('avoiding')).props['opacity'] ?? null, null, 'no class yet');

    instance.late.set('own global');
    await rerender();
    let props = inner(getByTestId('avoiding')).props;
    assert.equal(props['paddingLeft'], 24, "the writing component's own styles");
    assert.equal(props['opacity'], 0.5);
    assert.equal(props['rowGap'], 4, 'the global sheet');
    assert.equal(props['paddingTop'], 1, 'contentContainerStyle wins over the class');

    instance.behavior.set('padding');
    await rerender();
    instance.behavior.set('position');
    await rerender();
    props = inner(getByTestId('avoiding')).props;
    assert.equal(props['paddingLeft'], 24, 'a container made again takes it too');
    assert.equal(props['opacity'], 0.5);

    instance.late.set(undefined);
    await rerender();
    props = inner(getByTestId('avoiding')).props;
    assert.equal(props['paddingLeft'] ?? null, null, 'the class removed');
    assert.equal(props['opacity'] ?? null, null, 'and the component styles with it');
    cleanup();
  });
});
