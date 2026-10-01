/**
 * Values only the device knows, reaching the stylesheet.
 *
 * The safe-area insets are the case that forces this. A layout has to clear the notch and the home
 * indicator, the numbers differ per device and change on rotation, and nothing about them exists
 * at build time - so a stylesheet cannot hold them, and yet a stylesheet is exactly where a
 * padding belongs. On the web these are `env()`; here they are custom properties seeded on the
 * root, which the cascade already knows how to carry and a rule can already override.
 *
 * The engine imports nothing from React Native, so it is told, the same way conditions are.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, createFakeFabric, render, settle, type BoundQueries } from '@ng-native/testing';
import { compileFixture } from './compile.ts';
import { committedProps } from './tailwind-cli.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

after(cleanup);

describe('tokens the device supplies', () => {
  let Host: Type<unknown>;
  let queries: BoundQueries;
  let engine: Engine;
  let completeRootCalls: () => number;

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/device-tokens.ts', import.meta.url)),
    );
    Host = mod['DeviceTokenHost'] as Type<unknown>;
  });

  const boot = async (css = '', tokens?: Record<string, { length: number }>) => {
    const result = await render(Host, { globalStyles: compileCss(css, 'global'), tokens });
    queries = result;
    engine = result.componentRef.injector.get(Engine);
    completeRootCalls = () => result.fabric.calls.completeRoot;
  };

  const node = (id: string) => queries.getByTestId(id);

  it('falls back until a view has reported, which is a frame after mount', async () => {
    // Insets are a property of a view, not of the device: nothing knows them until something has
    // been laid out. A layout that would jump should say so with a fallback.
    await boot();
    assert.equal(node('button').props['marginBottom'], 16);
  });

  it('resolves what the device pushed in', async () => {
    await boot();
    engine.updateTokens({
      '--safe-area-inset-top': { length: 47 },
      '--safe-area-inset-bottom': { length: 34 },
    });
    await settle();
    assert.equal(node('bar').props['paddingTop'], 47);
    assert.equal(node('button').props['marginBottom'], 34);
  });

  it('re-resolves when the numbers change, with nothing in the app dirty', async () => {
    // A rotation changes no binding, so no view is dirty and a tick does no work. The engine has
    // to notice on its own, exactly as it does for a media query.
    await boot();
    engine.updateTokens({ '--safe-area-inset-top': { length: 47 } });
    await settle();
    engine.updateTokens({ '--safe-area-inset-top': { length: 20 } });
    await settle();
    assert.equal(node('bar').props['paddingTop'], 20);
  });

  it('adds to an inset, which is what clearing the home indicator means', async () => {
    // The insets are where the system's furniture ends, not where a layout should start. Almost
    // every real use of one is `the inset plus the padding this design already wanted`.
    await boot();
    assert.equal(node('gap').props['paddingBottom'], 12, 'the fallback, still added to');
    engine.updateTokens({ '--safe-area-inset-bottom': { length: 34 } });
    await settle();
    assert.equal(node('gap').props['paddingBottom'], 46);
  });

  it('takes whichever is larger, for a design that had a padding of its own', async () => {
    await boot();
    assert.equal(node('atleast').props['paddingBottom'], 16, 'no indicator, so the design wins');
    engine.updateTokens({ '--safe-area-inset-bottom': { length: 34 } });
    await settle();
    assert.equal(node('atleast').props['paddingBottom'], 34);
  });

  it('scales one', async () => {
    await boot();
    engine.updateTokens({ '--safe-area-inset-top': { length: 20 } });
    await settle();
    assert.equal(node('double').props['paddingTop'], 40);
  });

  it('takes what is known at startup from mount, so the first frame is right', async () => {
    // The pixel density is not measured, it is asked for, and the answer never changes. Nothing
    // about it should wait for a second commit the way an inset has to.
    await boot('', { '--hairline': { length: 1 / 3 } });
    assert.equal(node('divider').props['borderBottomWidth'], 1 / 3);
    assert.equal(completeRootCalls(), 1, 'no second commit to correct it');
  });

  it('keeps what one source pushed when another pushes its own', async () => {
    // The insets arrive from a view and the hairline from the device: different owners, one map.
    await boot('', { '--hairline': { length: 1 / 3 } });
    engine.updateTokens({ '--safe-area-inset-top': { length: 47 } });
    await settle();
    assert.equal(node('divider').props['borderBottomWidth'], 1 / 3, 'not wiped by the insets');
    assert.equal(node('bar').props['paddingTop'], 47);
  });

  it('lets the stylesheet override what the device said', async () => {
    // Seeded, not forced: they sit below `:root` in the cascade, so an app that wants to pin one
    // for a screenshot or a tablet layout still can.
    await boot(':root { --safe-area-inset-top: 0px }');
    engine.updateTokens({ '--safe-area-inset-top': { length: 47 } });
    await settle();
    assert.equal(node('bar').props['paddingTop'], 0);
  });
});

describe('tokens the device supplies, with no global sheet', () => {
  // The surface root matches no rule then, and resolves as a node with nothing to apply. A node
  // in that state shared one empty answer whatever the root held, so the first push after mount
  // dropped every seeded token below it and each inset fell back as if never reported.
  const inset = () => {
    const sheet = compileCss('.pad { padding-bottom: var(--safe-area-inset-bottom, 16px) }', 'x');
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {});
    const node = engine.createElement('view', sheet);
    engine.addClass(node, 'pad');
    engine.appendChild(engine.root, node);
    engine.commit();
    return { engine, read: () => committedProps(fabric, node)['paddingBottom'] };
  };

  it('resolves what the device pushed in', () => {
    const { engine, read } = inset();
    assert.equal(read(), 16, 'the fallback before anything is reported');
    engine.updateTokens({ '--safe-area-inset-bottom': { length: 34 } });
    assert.equal(read(), 34);
  });

  it('keeps the tokens through a second push', () => {
    const { engine, read } = inset();
    engine.updateTokens({ '--safe-area-inset-bottom': { length: 34 } });
    engine.updateTokens({ '--safe-area-inset-top': { length: 47 } });
    assert.equal(read(), 34);
  });
});

describe('env(), the way the web writes the insets', () => {
  // A stylesheet shared with the web writes env(safe-area-inset-*), and every one was refused
  // with "'padding-top: [object Object]' is not a value native can take". They read the tokens
  // the device supplies, exactly as the var() spelling does.
  const deferredOf = (css: string) => compileCss(`.a { ${css} }`).rules[0].deferred;

  it('reads a safe-area inset as the token of the same name', () => {
    assert.deepEqual(deferredOf('padding-top: env(safe-area-inset-top, 20px)'), [
      { props: ['paddingTop'], kind: 'length', reference: '--safe-area-inset-top', fallback: 20 },
    ]);
    assert.deepEqual(deferredOf('margin-bottom: calc(env(safe-area-inset-bottom) + 4px)'), [
      {
        props: ['marginBottom'],
        kind: 'length',
        reference: '--safe-area-inset-bottom',
        adjust: { offset: 4 },
      },
    ]);
  });

  it('refuses the environment values a device does not supply, by name', () => {
    assert.throws(() => deferredOf('padding-top: env(keyboard-inset-top)'), /keyboard-inset-top/);
  });
});
