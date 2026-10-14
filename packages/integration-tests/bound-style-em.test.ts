/**
 * A relative length in a bound style declaration: `[style.width]="'2em'"`, `'2rem'`, `'50vw'`.
 *
 * A stylesheet's `em` is measured against the font size in scope, and its `vw` against the
 * viewport. A bound one reached native as the text `'2em'`, which native drops, so the view had
 * no width at all.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, render, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Em {
  font: { set(value: number | undefined): void };
  width: { set(value: string | number | undefined): void };
}
let app: Awaited<ReturnType<typeof render<Em>>>;
const props = (id: string) => app.getByTestId(id).props;

before(async () => {
  const mod = await compileFixture('fixtures/bound-style-em.ts');
  app = await render(mod['BoundEm'] as Type<Em>);
});

after(cleanup);

describe('an em in a bound style declaration', () => {
  it('is 16 points to the em where no font size is in scope', () => {
    assert.equal(props('plain')['width'], 32);
    assert.equal(props('plain')['height'], 32);
  });

  it("is measured against the element's own font size", () => {
    assert.equal(props('own')['width'], 20);
  });

  it('is measured against the font size it inherits', () => {
    assert.equal(props('inherited')['width'], 40);
  });

  it('measures a font size against the one inherited, and the rest against that', () => {
    assert.equal(props('font')['fontSize'], 30);
    assert.equal(props('font')['width'], 60);
  });

  it('is read in a style object too', () => {
    assert.equal(props('object')['width'], 8);
    assert.equal(props('object')['marginTop'], 16);
  });

  it('is read in a static style attribute too', () => {
    assert.equal(props('static')['width'], 24);
    assert.equal(props('static')['marginTop'], 16);
  });

  it('gives a line height in points, as a stylesheet does', () => {
    assert.equal(props('line')['lineHeight'], 32);
    assert.equal(props('line')['minHeight'], 32);
  });

  it('is no length for a property that takes none', () => {
    // `flex-grow` is a number: the text is left as it is written, for native to drop.
    assert.equal(props('grow')['flexGrow'], '2em');
  });

  it('never reaches native as text', () => {
    const ids = ['plain', 'own', 'inherited', 'font', 'follows', 'switching', 'object', 'static'];
    for (const id of [...ids, 'line', 'rem', 'rem-object', 'rem-static']) {
      const sent = Object.values(props(id)).filter((value) => /\dr?em$/.test(String(value)));
      assert.deepEqual(sent, [], id);
    }
  });

  it('follows the inherited font size when it changes, and when it goes', async () => {
    assert.equal(props('follows')['width'], 24);
    app.instance.font.set(15);
    await settle();
    assert.equal(props('follows')['width'], 30);
    app.instance.font.set(undefined);
    await settle();
    assert.equal(props('follows')['width'], 32, 'the 16 an em falls back to');
    app.instance.font.set(12);
    await settle();
    assert.equal(props('follows')['width'], 24);
  });

  it('gives way to a written value, and to none at all', async () => {
    assert.equal(props('switching')['width'], 48);
    app.instance.width.set(10);
    await settle();
    assert.equal(props('switching')['width'], 10);
    app.instance.width.set('1em');
    await settle();
    assert.equal(props('switching')['width'], 16);
    app.instance.width.set(undefined);
    await settle();
    assert.equal(props('switching')['width'] ?? undefined, undefined);
  });
});

describe('a rem in a bound style declaration', () => {
  it('is 16 points, whatever the font size in scope', () => {
    assert.equal(props('rem')['width'], 32);
    assert.equal(props('rem')['marginTop'], 24);
  });

  it('is read in a style object and a static style attribute too', () => {
    assert.equal(props('rem-object')['width'], 8);
    assert.equal(props('rem-object')['marginTop'], 16);
    assert.equal(props('rem-static')['width'], 24);
    assert.equal(props('rem-static')['marginTop'], 16);
  });
});

describe('a viewport unit in a bound style declaration', () => {
  let viewport: Awaited<ReturnType<typeof render>>;
  const lengths = (id: string) => {
    const { width, height, marginTop, marginLeft } = viewport.getByTestId(id).props;
    return [width, height, marginTop, marginLeft];
  };

  before(async () => {
    const mod = await compileFixture('fixtures/bound-style-em.ts');
    viewport = await render(mod['BoundViewport'] as Type<unknown>, {
      conditions: { width: 400, height: 800, colorScheme: 'light' },
    });
  });

  it('is measured against the viewport, as a stylesheet one is', () => {
    assert.deepEqual(lengths('sheet'), [200, 80, 20, 40]);
    assert.deepEqual(lengths('bound'), [200, 80, 20, 40]);
  });

  it('follows the viewport when it changes', async () => {
    viewport.componentRef.injector
      .get(Engine)
      .updateConditions({ width: 1000, height: 500, colorScheme: 'light' });
    await settle();
    assert.deepEqual(lengths('sheet'), [500, 50, 25, 50]);
    assert.deepEqual(lengths('bound'), [500, 50, 25, 50]);
  });
});
