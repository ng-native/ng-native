/**
 * A word is not broken inside, as a browser never breaks one: text with nowhere to wrap, a
 * button's one-word label, is one line however narrow its box, and what does not fit is past
 * the edge. Native breaks a word that is wider than its line between any two letters, so a
 * squeezed button read "Suc / ces / s". A paragraph has no style for it: it is one line by its
 * `numberOfLines`, cut at the edge and not ended in an ellipsis nobody asked for.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

function scene(css = '') {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  /** A text element called `id` holding `words`, with `classes`. */
  const say = (id: string, words: string, classes = ''): EngineNode => {
    const text = engine.createElement('text');
    if (classes) engine.setClasses(text, classes);
    engine.setProp(text, 'testID', id);
    engine.appendChild(text, engine.createText(words));
    engine.appendChild(engine.root, text);
    return text;
  };
  const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...all(node.children)]);
  /** How the paragraph called `id` is committed to wrap: its lines, and how it is cut. */
  const lines = (id: string): unknown[] => {
    engine.commit();
    const { props } = all(fabric.committed).find((each) => each.props['testID'] === id)!;
    return [props['numberOfLines'] ?? null, props['ellipsizeMode'] ?? null];
  };
  /** The committed view called `id`. */
  const committed = (id: string): FakeFabricNode =>
    all(fabric.committed).find((each) => each.props['testID'] === id)!;
  return { engine, say, lines, committed };
}

describe('text with nowhere to wrap', () => {
  it('is one line, cut at the edge, where it is one word', () => {
    const s = scene();
    s.say('word', 'Success');
    s.say('padded', '  Secondary\n');
    assert.deepEqual(s.lines('word'), [1, 'clip']);
    assert.deepEqual(s.lines('padded'), [1, 'clip'], 'the space around it is collapsed away');
  });

  it('wraps as it did where there is a space, a hyphen or a script with no spaces', () => {
    const s = scene();
    s.say('two', 'Sign in');
    s.say('hyphen', 'well-known');
    s.say('cjk', '日本語のテキスト');
    s.say('empty', '');
    for (const id of ['two', 'hyphen', 'cjk', 'empty']) {
      assert.deepEqual(s.lines(id), [null, 'tail'], id);
    }
  });

  it('keeps the lines and the ending a rule gives it', () => {
    const s = scene('.two { line-clamp: 2 } .dots { text-overflow: ellipsis }');
    s.say('two', 'Supercalifragilistic', 'two');
    s.say('dots', 'Supercalifragilistic', 'dots');
    assert.deepEqual(s.lines('two'), [2, 'tail']);
    assert.deepEqual(s.lines('dots'), [1, 'tail']);
  });

  it('is so for text written straight into a view, and follows it changing', () => {
    // The paragraph is one the engine makes for the text, and is no child of the view's.
    const s = scene();
    const view = s.engine.createElement('view');
    s.engine.setProp(view, 'testID', 'box');
    const words = s.engine.createText('Save');
    s.engine.appendChild(view, words);
    s.engine.appendChild(s.engine.root, view);
    const paragraph = (): unknown[] => {
      s.engine.commit();
      const [made] = s.committed('box').children;
      return [made!.props['numberOfLines'] ?? null, made!.props['ellipsizeMode'] ?? null];
    };
    assert.deepEqual(paragraph(), [1, 'clip']);
    s.engine.setText(words, 'Save all');
    assert.deepEqual(paragraph(), [null, 'tail']);
    s.engine.setText(words, 'Saved');
    assert.deepEqual(paragraph(), [1, 'clip']);
  });

  it('keeps an ending a style override gives it', () => {
    const s = scene();
    const label = s.say('label', 'Supercalifragilistic');
    s.engine.setProp(label, 'styleOverride', { ellipsizeMode: 'head' });
    assert.deepEqual(s.lines('label'), [1, 'head']);
  });

  it('follows the text changing, and a run coming to be in it', () => {
    const s = scene();
    const label = s.say('label', 'Save');
    assert.deepEqual(s.lines('label'), [1, 'clip']);
    s.engine.setText(label.children[0]!, 'Save all');
    assert.deepEqual(s.lines('label'), [null, 'tail']);
    s.engine.setText(label.children[0]!, 'Saved');
    assert.deepEqual(s.lines('label'), [1, 'clip']);
    // A second run, with the space between the two words in it.
    const more = s.engine.createElement('text');
    s.engine.appendChild(more, s.engine.createText(' now'));
    s.engine.appendChild(label, more);
    assert.deepEqual(s.lines('label'), [null, 'tail']);
    s.engine.removeChild(label, more);
    assert.deepEqual(s.lines('label'), [1, 'clip']);
  });
});
