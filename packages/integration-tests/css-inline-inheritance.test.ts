/**
 * An inherited property set by inline style, `[style.color]` or `[style.fontSize]`.
 *
 * Inline style is the strongest normal declaration on its element, so the text inside inherits it,
 * and `color: inherit` and `currentColor` read it, under it and on the element itself. An
 * `!important` rule beats it. The expected values were read from Chrome's `getComputedStyle` with
 * the same rules and inline style.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { cleanup, createFakeFabric, render, screen } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const SHEET =
  '.outer { color: rgb(0, 0, 1); font-size: 10px } .inherit { color: inherit } ' +
  '.current { color: currentColor } .bg { background-color: currentColor } ' +
  '.imp { color: rgb(0, 0, 2) !important }';
const RED = 'rgb(255, 0, 0)';

/** A view wearing `outer` and `parent`, with an inline style, around a text wearing `child`. */
function tree(parent: string, child: string, inline: Record<string, unknown> | null) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(SHEET) as StyleSheet });
  const view = engine.createElement('view');
  const text = engine.createElement('text');
  engine.setClasses(view, `outer ${parent}`);
  engine.setClasses(text, child);
  if (inline) engine.setProp(view, 'style', inline);
  engine.appendChild(engine.root, view);
  engine.appendChild(view, text);
  engine.commit();
  const props = () => fabric.committed[0]!;
  return {
    engine,
    view,
    view_: () => props().props,
    text: () => props().children[0]!.props,
  };
}

describe('an inherited property set by inline style', () => {
  it('is inherited by the text inside', () => {
    assert.equal(tree('', '', { color: RED }).text()['color'], RED);
    assert.equal(tree('', '', { fontSize: 20 }).text()['fontSize'], 20);
  });

  it('is what color: inherit and currentColor read under it', () => {
    assert.equal(tree('', 'inherit', { color: RED }).text()['color'], RED);
    assert.equal(tree('', 'current', { color: RED }).text()['color'], RED);
  });

  it('is what currentColor reads on the element itself', () => {
    assert.equal(tree('bg', '', { color: RED }).view_()['backgroundColor'], RED);
  });

  it('is the last value an inline style array gives, so a later null clears it', () => {
    assert.equal(
      tree('', '', [{ color: RED }, { color: null }] as never).text()['color'],
      'rgb(0, 0, 1)',
    );
    assert.equal(
      tree('', '', [{ color: 'rgb(0, 0, 9)' }, { color: RED }] as never).text()['color'],
      RED,
    );
  });

  it('loses to an important rule', () => {
    assert.equal(tree('imp', '', { color: RED }).text()['color'], 'rgb(0, 0, 2)');
  });

  it('is followed when it changes, and the rule comes back when it goes', () => {
    const { engine, view, text } = tree('', '', { color: RED });
    engine.setProp(view, 'style', { color: 'rgb(0, 255, 0)' });
    engine.commit();
    assert.equal(text()['color'], 'rgb(0, 255, 0)');
    engine.setProp(view, 'style', { opacity: 0.5 });
    engine.commit();
    assert.equal(text()['color'], 'rgb(0, 0, 1)');
  });

  it('is inherited from a binding, as it changes, in an app with no stylesheet', async () => {
    const mod = await compileFixture('fixtures/inline-colour.ts');
    const { fixture } = await render(mod['InlineColour'] as Type<unknown>);
    assert.equal(screen.getByTestId('inside').props['color'], RED);
    (fixture.componentInstance as { colour: { set(v: string): void } }).colour.set(
      'rgb(0, 0, 255)',
    );
    fixture.detectChanges();
    assert.equal(screen.getByTestId('inside').props['color'], 'rgb(0, 0, 255)');
    cleanup();
  });
});
