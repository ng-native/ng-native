/**
 * `Engine.colour` and `Engine.watchColour`: the colour a node draws `currentColor` in, read from
 * TypeScript, as `token` and `watchToken` read a custom property. A drawing that has to know
 * whether that colour is opaque before its shapes are drawn reads the best answer there is, and
 * hears the settled one after each commit.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

const CSS =
  ':root { --ink: rgba(0, 0, 0, 0.5) } .plain { color: red } .tok { color: var(--ink) }' +
  ' .blue { color: blue } @media (prefers-color-scheme: dark) { :root { --ink: white } }';

function scene(onError?: (error: unknown, type: string) => void) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(CSS, 'app.css') as never,
    conditions: { width: 400, height: 800, colorScheme: 'light' },
    onError,
  });
  const view = (parent: EngineNode) => {
    const node = engine.createElement('view');
    engine.appendChild(parent, node);
    return node;
  };
  const scheme = (colorScheme: 'light' | 'dark') =>
    engine.updateConditions({ width: 400, height: 800, colorScheme });
  return { engine, fabric, view, scheme };
}

describe("a node's colour read from TypeScript", () => {
  it('is the colour its last commit settled, from a rule, its parent, its style or a token', () => {
    const { engine, view } = scene();
    const ruled = view(engine.root);
    engine.addClass(ruled, 'plain');
    const child = view(ruled);
    const inline = view(ruled);
    engine.setProp(inline, 'style', { color: '#00ff0080' });
    const token = view(engine.root);
    engine.addClass(token, 'tok');
    const bare = view(engine.root);
    engine.commit();
    assert.equal(engine.colour(ruled), 'rgb(255, 0, 0)');
    assert.equal(engine.colour(child), 'rgb(255, 0, 0)', 'inherited');
    assert.equal(engine.colour(inline), '#00ff0080');
    assert.equal(engine.colour(token), 'rgba(0, 0, 0, 0.5)');
    assert.equal(engine.colour(bare), undefined, 'nothing sets one, and native draws black');
  });

  it("is, before a node's first commit, its own style's or its nearest committed ancestor's", () => {
    const { engine, fabric, view } = scene();
    const ruled = view(engine.root);
    engine.addClass(ruled, 'plain');
    engine.commit();
    const sent = fabric.committed.length;
    const added = view(ruled);
    const deeper = view(added);
    assert.equal(engine.colour(deeper), 'rgb(255, 0, 0)');
    engine.setProp(added, 'style', { color: 'blue' });
    assert.equal(engine.colour(deeper), 'blue', 'the style it was given, not yet settled');
    assert.equal(fabric.committed.length, sent, 'reading it commits nothing');
    engine.commit();
    assert.equal(
      engine.colour(deeper),
      'blue',
      'and the commit after it still sends the new nodes',
    );
  });

  it('is, for a node left out of the cascade, the colour of the drawing it is in', () => {
    const { engine, view } = scene();
    const ruled = view(engine.root);
    engine.addClass(ruled, 'plain');
    const shape = engine.createElement('view');
    shape.outsideCascade = true;
    engine.appendChild(ruled, shape);
    engine.commit();
    assert.equal(engine.colour(shape), 'rgb(255, 0, 0)');
  });

  it('is nothing before any commit, where no style names one', () => {
    const { engine, view } = scene();
    assert.equal(engine.colour(view(engine.root)), undefined);
  });
});

describe("a node's colour watched", () => {
  function watching() {
    const s = scene();
    const parent = s.view(s.engine.root);
    const node = s.view(parent);
    const heard: unknown[] = [];
    const stop = s.engine.watchColour(node, (value) => heard.push(value));
    return { ...s, parent, node, heard, stop };
  }

  it('is reported after each commit that changes it, the first included, and not otherwise', () => {
    const { engine, parent, heard } = watching();
    engine.addClass(parent, 'plain');
    engine.commit();
    assert.deepEqual(heard, ['rgb(255, 0, 0)']);
    engine.commit();
    engine.setProp(parent, 'nativeID', 'unrelated');
    engine.commit();
    assert.deepEqual(heard, ['rgb(255, 0, 0)'], 'not when it stays');
    engine.removeClass(parent, 'plain');
    engine.addClass(parent, 'blue');
    engine.commit();
    assert.deepEqual(heard, ['rgb(255, 0, 0)', 'rgb(0, 0, 255)']);
  });

  it('follows a token the colour is written in, through a change of colour scheme', () => {
    const { engine, parent, heard, scheme } = watching();
    engine.addClass(parent, 'tok');
    engine.commit();
    scheme('dark');
    engine.commit();
    assert.deepEqual(heard, ['rgba(0, 0, 0, 0.5)', 'rgb(255, 255, 255)']);
  });

  it('stops when told to', () => {
    const { engine, parent, heard, stop } = watching();
    stop();
    engine.addClass(parent, 'plain');
    engine.commit();
    assert.deepEqual(heard, []);
  });

  it('hands a listener that throws to the error handler, and still tells the others', () => {
    const errors: string[] = [];
    const { engine, view } = scene((_, type) => errors.push(type));
    const parent = view(engine.root);
    const first = view(parent);
    const second = view(parent);
    const heard: unknown[] = [];
    engine.watchColour(first, () => {
      throw new Error('listener');
    });
    engine.watchColour(second, (value) => heard.push(value));
    engine.addClass(parent, 'plain');
    engine.commit();
    assert.deepEqual(errors, ['colour']);
    assert.deepEqual(heard, ['rgb(255, 0, 0)']);
  });
});
