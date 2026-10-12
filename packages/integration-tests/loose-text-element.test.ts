/**
 * A view whose own words are drawn by a child that is not a paragraph: an SVG text draws nothing
 * itself, and its words by a span. Registered with `looseText`, such a view has the engine keep
 * that element for the text written straight into it, as any other view has it keep a paragraph.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, registerViewName } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

registerViewName('x-drawn-text', 'DrawnText', undefined, { looseText: 'x-drawn-span' });
registerViewName('x-drawn-span', 'DrawnSpan', undefined, { textContent: 'content' });

/** A root holding one `<x-drawn-text>`, committed. */
function scene() {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const text = engine.createElement('x-drawn-text');
  engine.appendChild(engine.root, text);
  const committed = (): FakeFabricNode => fabric.committed[0]!;
  return { engine, text, committed };
}

const drawn = (view: FakeFabricNode) =>
  view.children.map((child) => [child.viewName, child.props['content']]);

describe('a view registered with looseText', () => {
  it('draws the text written inside it by the element it names, with the words as its prop', () => {
    const { engine, text, committed } = scene();
    engine.appendChild(text, engine.createText('Germany'));
    engine.commit();
    assert.deepEqual(drawn(committed()), [['DrawnSpan', 'Germany']]);
  });

  it('follows the text as it changes, and takes the element away with it', () => {
    const { engine, text, committed } = scene();
    const run = engine.createText('0');
    engine.appendChild(text, run);
    engine.commit();
    engine.setText(run, '15');
    engine.commit();
    assert.deepEqual(drawn(committed()), [['DrawnSpan', '15']]);
    engine.removeChild(text, run);
    engine.commit();
    assert.deepEqual(drawn(committed()), []);
  });

  it('keeps a child written beside the text where it was written', () => {
    const { engine, text, committed } = scene();
    engine.appendChild(text, engine.createText('Sales'));
    const own = engine.createElement('x-drawn-span');
    engine.appendChild(own, engine.createText('2025'));
    engine.appendChild(text, own);
    engine.commit();
    assert.deepEqual(drawn(committed()), [
      ['DrawnSpan', 'Sales'],
      ['DrawnSpan', '2025'],
    ]);
  });

  it('goes back to a paragraph once the view is registered again and names none', () => {
    registerViewName('x-drawn-once', 'DrawnOnce', undefined, { looseText: 'x-drawn-span' });
    registerViewName('x-drawn-once', 'DrawnOnce');
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const view = engine.createElement('x-drawn-once');
    engine.appendChild(engine.root, view);
    engine.appendChild(view, engine.createText('Plain'));
    engine.commit();
    assert.deepEqual(
      fabric.committed[0]!.children.map((child) => child.viewName),
      ['Paragraph'],
    );
  });

  it('draws text already there by another element once the view names another', () => {
    registerViewName('x-drawn-twice', 'DrawnTwice', undefined, { looseText: 'x-drawn-span' });
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const view = engine.createElement('x-drawn-twice');
    engine.appendChild(engine.root, view);
    const run = engine.createText('One');
    engine.appendChild(view, run);
    engine.commit();
    const kinds = () => fabric.committed[0]!.children.map((child) => child.viewName);
    assert.deepEqual(kinds(), ['DrawnSpan']);
    // The element kept for the text is the one named when it was made: not the one to keep.
    registerViewName('x-drawn-twice', 'DrawnTwice');
    engine.setText(run, 'Two');
    engine.commit();
    assert.deepEqual(kinds(), ['Paragraph']);
    registerViewName('x-drawn-twice', 'DrawnTwice', undefined, { looseText: 'x-drawn-span' });
    engine.setText(run, 'Three');
    engine.commit();
    assert.deepEqual(drawn(fabric.committed[0]!), [['DrawnSpan', 'Three']]);
  });

  it('leaves a view that names none with a paragraph for its text', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const view = engine.createElement('view');
    engine.appendChild(engine.root, view);
    engine.appendChild(view, engine.createText('Plain'));
    engine.commit();
    assert.deepEqual(
      fabric.committed[0]!.children.map((child) => child.viewName),
      ['Paragraph'],
    );
  });
});
