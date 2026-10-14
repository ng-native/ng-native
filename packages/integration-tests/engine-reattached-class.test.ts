/**
 * A class named only as what a rule's element is inside (`.dark .title`) restyles the elements
 * under the node by walking its children. An element out of the tree at that moment is not
 * walked, so one put back after the class changed is matched again, with what is under it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

function scene(css: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as StyleSheet });
  const make = (classes: string, parent: EngineNode): EngineNode => {
    const node = engine.createElement('view');
    engine.setClasses(node, classes);
    engine.appendChild(parent, node);
    return node;
  };
  const app = make('app', engine.root);
  const card = make('card', app);
  const title = make('title', card);
  engine.commit();
  const titleProps = () => fabric.committed[0]!.children[0]!.children[0]!.props;
  return { engine, app, card, title, titleProps };
}

const CSS = '.title { opacity: 1 } .dark .title { opacity: 0.5 }';

describe('an element put back after a class changed above it', () => {
  it('control: is styled by the class when it never left', () => {
    const s = scene(CSS);
    s.engine.addClass(s.app, 'dark');
    s.engine.commit();
    assert.equal(s.titleProps()['opacity'], 0.5);
  });

  it('is styled by a class its ancestor gained while it was out', () => {
    const s = scene(CSS);
    s.engine.removeChild(s.card, s.title);
    s.engine.commit();
    s.engine.addClass(s.app, 'dark');
    s.engine.commit();
    s.engine.appendChild(s.card, s.title);
    s.engine.commit();
    assert.equal(s.titleProps()['opacity'], 0.5);
  });

  it('loses the style of a class its ancestor lost while it was out', () => {
    const s = scene(CSS);
    s.engine.addClass(s.app, 'dark');
    s.engine.commit();
    assert.equal(s.titleProps()['opacity'], 0.5);
    s.engine.removeChild(s.card, s.title);
    s.engine.commit();
    s.engine.removeClass(s.app, 'dark');
    s.engine.commit();
    s.engine.appendChild(s.card, s.title);
    s.engine.commit();
    assert.equal(s.titleProps()['opacity'], 1);
  });

  it('is styled by it when the whole card was out, and the card is no element of the rule', () => {
    const s = scene(CSS);
    s.engine.removeChild(s.app, s.card);
    s.engine.commit();
    s.engine.addClass(s.app, 'dark');
    s.engine.commit();
    s.engine.appendChild(s.app, s.card);
    s.engine.commit();
    assert.equal(s.titleProps()['opacity'], 0.5);
  });
});
