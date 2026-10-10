/**
 * `::ng-deep`, where something is written before it: `:host ::ng-deep .inner` styles `.inner`
 * anywhere under the component's host, in the views of the components it holds as well, which
 * is what it is for in a browser. A library reaches into the components it is built from this
 * way. Written first, with nothing before it, it is a rule for the whole app and stays refused.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, screen, settle, compileCss } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

after(cleanup);

describe('::ng-deep under a component', () => {
  let Page: Type<unknown>;
  let Frame: Type<{ lit: { set(value: boolean): void } }>;

  before(async () => {
    const mod = await compileFixture('fixtures/ng-deep.ts');
    Page = mod['DeepPage'] as Type<unknown>;
    Frame = mod['DeepFrame'] as typeof Frame;
  });

  const page = async () => {
    const app = await render(Page);
    await settle();
    return app;
  };
  const props = (id: string) => screen.getByTestId(id).props;

  it('styles what is under the host, through the views of the components in it', async () => {
    await page();
    assert.equal(props('inner-a')['opacity'], 0.5);
    assert.equal(props('inner-b')['opacity'], 0.5);
  });

  it('styles nothing outside the host, though it matches the rest of the selector', async () => {
    await page();
    assert.equal(props('inner-c')['opacity'], undefined);
    assert.equal(props('inner-c')['paddingTop'], undefined);
  });

  it('is anchored by an element of the component, as well as by its host', async () => {
    // `.wrap ::ng-deep .mark`: under the frame's own `.wrap`, and not under its `.plain`.
    await page();
    assert.equal(props('inner-a')['paddingTop'], 7);
    assert.equal(props('inner-b')['paddingTop'], undefined);
  });

  it('leaves a rule with no piercing to the elements of the component it is written in', async () => {
    await page();
    assert.equal(props('inner-a')['marginTop'], undefined);
  });

  it('follows a class changing on what it styles', async () => {
    const app = await render(Frame);
    await settle();
    assert.equal(props('inner-a')['opacity'], 0.5);
    app.instance.lit.set(true);
    await app.rerender();
    assert.equal(props('inner-a')['opacity'], 0.25);
    app.instance.lit.set(false);
    await app.rerender();
    assert.equal(props('inner-a')['opacity'], 0.5);
  });
});

describe('::ng-deep with nothing before it', () => {
  it('is refused, as a rule for the whole app written in a component', () => {
    for (const css of ['::ng-deep .inner { color: red }', '::ng-deep { color: red }']) {
      assert.throws(() => compileCss(css), /'::ng-deep'.*nothing before it/s, css);
    }
  });

  it('compiles with a host or an element before it, and says nothing', () => {
    const warnings: string[] = [];
    const sheet = compileCss(
      ':host ::ng-deep .a { color: red } .b ::ng-deep .c { color: red } :host::ng-deep .d { color: red }',
      'x',
      { onUnsupported: (message: string) => warnings.push(message) },
    );
    assert.deepEqual(warnings, []);
    assert.equal(sheet.rules.length, 3);
  });
});
