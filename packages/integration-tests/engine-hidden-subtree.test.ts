/**
 * A change beneath a `display: none` element reaches a commit: the hidden element is not
 * reconciled, and the marks that lead a commit to a change are cleared under it all the same.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

const sheet = (css: string) => compileCss(css, 'app.css') as StyleSheet;

function scene(css: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet(css) });
  const make = (classes: string, parent: EngineNode): EngineNode => {
    const node = engine.createElement('view');
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', classes);
    engine.appendChild(parent, node);
    return node;
  };
  return { fabric, engine, make };
}

describe('a change beneath an element that is display: none', () => {
  it('shows the element again once its :has() no longer holds', () => {
    const s = scene('.panel:has(> .empty) { display: none }');
    const panel = s.make('panel', s.engine.root);
    const child = s.make('empty', panel);
    s.engine.commit();
    assert.equal(s.fabric.render(), '', 'hidden while it holds an .empty child');
    s.engine.removeClass(child, 'empty');
    assert.equal(s.engine.commit(), true, 'the change is committed');
    assert.equal(s.fabric.render(), 'View\n  View');
  });

  it('restyles an ancestor whose :has() reads into the hidden element', () => {
    const s = scene('.hidden { display: none } .page:has(.flag) { opacity: 0.5 }');
    const page = s.make('page', s.engine.root);
    const hidden = s.make('hidden', page);
    const child = s.make('x', hidden);
    s.engine.commit();
    assert.equal(s.fabric.committed[0]!.props['opacity'], undefined);
    s.engine.addClass(child, 'flag');
    s.engine.commit();
    assert.equal(s.fabric.committed[0]!.props['opacity'], 0.5);
  });
});
