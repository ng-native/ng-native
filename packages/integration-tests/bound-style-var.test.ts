/**
 * A `var()` in a bound style declaration: `[style.background-color]="'var(--surface)'"`.
 *
 * A bound custom property already resolves a `var()`. This is the other half, an ordinary
 * declaration reading a token, which a browser resolves against the cascade. The text `var(...)`
 * is no value native can paint.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { cleanup, render, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Vars {
  surface: { set(value: string | undefined): void };
  colour: { set(value: string | undefined): void };
}
let app: Awaited<ReturnType<typeof render<Vars>>>;
const props = (id: string) => app.getByTestId(id).props;

before(async () => {
  const mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/bound-style-var.ts', import.meta.url)),
  );
  app = await render(mod['BoundVars'] as Type<Vars>);
});

after(cleanup);

describe('a var() in a bound style declaration', () => {
  it('reads the token in scope', () => {
    assert.equal(props('card')['backgroundColor'], 'rgb(1, 2, 3)');
  });

  it('reads the nearest token, as a length where the property is one', () => {
    assert.equal(props('inner')['backgroundColor'], 'rgb(4, 5, 6)');
    assert.equal(props('inner')['width'], 40);
  });

  it('takes its fallback, written or another token, when the token is unset', () => {
    assert.equal(props('fallback')['backgroundColor'], 'rgb(7, 8, 9)');
    assert.equal(props('chain')['backgroundColor'], 'rgb(1, 2, 3)');
  });

  it('is inherited where the property is, as a bound colour is', () => {
    assert.equal(props('label')['color'], 'rgb(1, 2, 3)');
  });

  it('is read in a style object too', () => {
    assert.equal(props('object')['opacity'], 0.5);
  });

  it('reads a fallback of currentColor as the colour of the element', () => {
    assert.equal(props('current')['borderTopColor'], 'rgb(3, 3, 3)');
  });

  it('reads a display token as the display native has for it', () => {
    assert.equal(props('kinds')['display'], 'flex', 'block is flex on native');
  });

  it('never reaches native as text', () => {
    for (const id of ['card', 'inner', 'fallback', 'chain', 'tinted', 'switching', 'object']) {
      const sent = Object.values(props(id)).filter((value) => /var\(/.test(String(value)));
      assert.deepEqual(sent, [], id);
    }
  });

  it('follows the token when it changes, and falls back when it goes', async () => {
    app.instance.surface.set('rgb(9, 9, 9)');
    await settle();
    assert.equal(props('inner')['backgroundColor'], 'rgb(9, 9, 9)');
    app.instance.surface.set(undefined);
    await settle();
    assert.equal(props('inner')['backgroundColor'], 'rgb(1, 2, 3)', "the host's again");
  });

  it('gives way to a written value, and to none at all', async () => {
    assert.equal(props('switching')['backgroundColor'], 'rgb(1, 2, 3)');
    app.instance.colour.set('rgb(5, 5, 5)');
    await settle();
    assert.equal(props('switching')['backgroundColor'], 'rgb(5, 5, 5)');
    app.instance.colour.set('var(--surface)');
    await settle();
    assert.equal(props('switching')['backgroundColor'], 'rgb(1, 2, 3)');
    app.instance.colour.set(undefined);
    await settle();
    assert.equal(props('switching')['backgroundColor'] ?? undefined, undefined);
  });
});

describe('a bound var() nothing defines', () => {
  it('is said in development, naming the property and the element', async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/bound-style-var.ts', import.meta.url)),
    );
    const warn = console.warn;
    const said: string[] = [];
    console.warn = (...args: unknown[]) => said.push(args.map(String).join(' '));
    try {
      await render(mod['Unset'] as Type<unknown>, { dev: true });
    } finally {
      console.warn = warn;
    }
    assert.match(said.join('\n'), /var\(--nowhere\) in backgroundColor, bound on <view>/);
  });
});
