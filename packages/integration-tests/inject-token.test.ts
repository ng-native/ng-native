/**
 * `injectToken`: a custom property's value as a signal, for a prop, a drawing or an API that takes
 * a colour rather than a style, and that follows the colour scheme.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, compileCss, render, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const CSS =
  ':root { --brand: #ff0000; --accent: var(--brand) }' +
  ' @media (prefers-color-scheme: dark) { :root { --brand: #0000ff } } .local { --accent: #123456 }';

async function scene() {
  const mod = await compileFixture('fixtures/inject-token.ts');
  const view = await render(mod['InjectToken'] as Type<{ scoped: { set(on: boolean): void } }>, {
    globalStyles: compileCss(CSS, 'app.css') as never,
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });
  const engine = view.componentRef.injector.get(Engine);
  const text = (id: string) => view.getByTestId(id).children[0]?.props['text'];
  const scheme = async (colorScheme: 'light' | 'dark') => {
    engine.updateConditions({ width: 400, height: 800, colorScheme });
    await settle();
  };
  return { view, engine, text, scheme };
}

describe('injectToken', () => {
  afterEach(cleanup);

  it('is the root’s value in the first commit, and undefined for a token nothing defines', async () => {
    const { text, view } = await scene();
    assert.equal(text('root'), 'rgb(255, 0, 0)');
    assert.equal(text('missing'), 'none');
    assert.equal(view.fabric.committed.length > 0, true);
  });

  it('follows the colour scheme', async () => {
    const { text, scheme } = await scene();
    await scheme('dark');
    assert.equal(text('root'), 'rgb(0, 0, 255)');
    await scheme('light');
    assert.equal(text('root'), 'rgb(255, 0, 0)');
  });

  it('reads the value in scope at a node it is given', async () => {
    const { text } = await scene();
    assert.equal(text('scoped'), 'rgb(18, 52, 86)');
  });

  it('stops watching when its component goes', async () => {
    const { view, engine } = await scene();
    const watches = () => (engine as unknown as { tokenWatches: Set<unknown> }).tokenWatches.size;
    assert.equal(watches(), 3);
    view.instance.scoped.set(false);
    await view.detectChanges();
    assert.equal(watches(), 2);
    view.unmount();
    assert.equal(watches(), 0);
  });
});
