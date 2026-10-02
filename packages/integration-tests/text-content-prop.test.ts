/**
 * A view whose text is a prop rather than children: SwiftUI's `Text` through `@expo/ui` reads its
 * text from `text`, and takes no child views. Registered with `textContent`, such a view takes the
 * text written inside it as that prop, as `<text>` takes its own content, so `<ui-text>Hello</ui-text>`
 * shows Hello rather than nothing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, registerViewName } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

registerViewName('x-label', 'LabelView', undefined, { textContent: 'text' });
registerViewName('x-titled', 'TitledView', { text: 'Untitled' }, { textContent: 'text' });

/** A root holding one `<x-label>`, committed. */
function scene() {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const label = engine.createElement('x-label');
  engine.appendChild(engine.root, label);
  const committed = (): FakeFabricNode => fabric.committed[0]!;
  return { engine, fabric, label, committed };
}

describe('a view registered with textContent', () => {
  it('takes the text written inside it as the prop, and commits no text children', () => {
    const { engine, label, committed } = scene();
    engine.appendChild(label, engine.createText('Hello'));
    engine.commit();
    assert.equal(committed().props['text'], 'Hello');
    assert.deepEqual(committed().children, [], 'no RawText under a view that takes no children');
  });

  it('joins several runs, as an interpolation between literal text makes them', () => {
    const { engine, label, committed } = scene();
    engine.appendChild(label, engine.createText('Us '));
    engine.appendChild(label, engine.createText('30'));
    engine.appendChild(label, engine.createText(' - 15'));
    engine.commit();
    assert.equal(committed().props['text'], 'Us 30 - 15');
  });

  it('follows the text as it changes, and as runs are added and removed', () => {
    const { engine, label, committed } = scene();
    const run = engine.createText('0');
    engine.appendChild(label, run);
    engine.commit();
    engine.setText(run, '15');
    engine.commit();
    assert.equal(committed().props['text'], '15');
    const more = engine.createText(' all');
    engine.appendChild(label, more);
    engine.commit();
    assert.equal(committed().props['text'], '15 all');
    engine.removeChild(label, more);
    engine.commit();
    assert.equal(committed().props['text'], '15');
  });

  it('drops the whitespace at the two ends, as a paragraph does, and keeps it inside', () => {
    const { engine, label, committed } = scene();
    engine.appendChild(label, engine.createText('\n  Sets 0-0  Games 2-1\n'));
    engine.commit();
    assert.equal(committed().props['text'], 'Sets 0-0  Games 2-1');
  });

  it('lets an explicit prop win over the content', () => {
    const { engine, label, committed } = scene();
    engine.appendChild(label, engine.createText('content'));
    engine.setProp(label, 'text', 'bound');
    engine.commit();
    assert.equal(committed().props['text'], 'bound');
  });

  it('leaves the prop alone when there is no content', () => {
    const { engine, label, committed } = scene();
    engine.setProp(label, 'text', 'bound');
    engine.commit();
    assert.equal(committed().props['text'], 'bound');
  });

  it('keeps a nested view as a child, and the space before it, for a span drawn after the text', () => {
    // SwiftUI's `Text` through `@expo/ui` draws its own text and then each child `Text` after it.
    const { engine, label, committed } = scene();
    engine.appendChild(label, engine.createText('Us '));
    const span = engine.createElement('x-label');
    engine.appendChild(span, engine.createText('30'));
    engine.appendChild(label, span);
    engine.commit();
    assert.equal(committed().props['text'], 'Us ', 'the space before the span is kept');
    assert.equal(committed().children.length, 1);
    assert.equal(committed().children[0]!.props['text'], '30');
  });

  it('keeps and drops the space before a span as the span comes and goes', () => {
    const { engine, label, committed } = scene();
    engine.appendChild(label, engine.createText('Us '));
    engine.commit();
    assert.equal(committed().props['text'], 'Us');
    const span = engine.createElement('x-label');
    engine.appendChild(label, span);
    engine.commit();
    assert.equal(committed().props['text'], 'Us ');
    engine.removeChild(label, span);
    engine.commit();
    assert.equal(committed().props['text'], 'Us');
  });

  it('lets the content win over a default the view is registered with', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const titled = engine.createElement('x-titled');
    engine.appendChild(engine.root, titled);
    engine.commit();
    assert.equal(fabric.committed[0]!.props['text'], 'Untitled', 'the default, with no content');
    engine.appendChild(titled, engine.createText('Match'));
    engine.commit();
    assert.equal(fabric.committed[0]!.props['text'], 'Match');
  });

  it('leaves text under an ordinary view as children', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const paragraph = engine.createElement('text');
    engine.appendChild(engine.root, paragraph);
    engine.appendChild(paragraph, engine.createText('Hi'));
    engine.commit();
    assert.equal(fabric.committed[0]!.children.length, 1);
    assert.equal(fabric.committed[0]!.props['text'], undefined);
  });
});
