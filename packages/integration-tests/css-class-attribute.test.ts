/**
 * A selector that reads the `class` attribute, `[class*='size-']`, reads the element's class list
 * as a browser does: the classes in order, one space between each. A component library writes it
 * to style an icon that sets no size of its own, `svg:not([class*='size-'])`, so a class that says
 * one has to stop the rule matching.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

function scene(css: string) {
  const reports: string[] = [];
  const sheet = compileCss(css, 'app.css', {
    onUnsupported: (message: string) => reports.push(message),
  }) as StyleSheet;
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet });
  const add = (classes: string, id: string, parent: EngineNode = engine.root): EngineNode => {
    const node = engine.createElement('view');
    if (classes) engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', id);
    engine.appendChild(parent, node);
    return node;
  };
  const opacity = (id: string): unknown => {
    engine.commit();
    const find = (nodes: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const each of nodes) {
        const found = each.props['nativeID'] === id ? each : find(each.children);
        if (found) return found;
      }
      return undefined;
    };
    return find(fabric.committed)!.props['opacity'];
  };
  return { reports, engine, add, opacity };
}

describe('a selector reading the class attribute', () => {
  it('matches part of a class with *=', () => {
    const s = scene('[class*="col-"] { opacity: 0.5 }');
    s.add('row col-6', 'col');
    s.add('row', 'row');
    assert.deepEqual(s.reports, []);
    assert.equal(s.opacity('col'), 0.5);
    assert.equal(s.opacity('row'), undefined);
  });

  it('matches one whole class with ~=', () => {
    const s = scene('[class~="exact"] { opacity: 0.5 }');
    s.add('foo exact', 'whole');
    s.add('foo exactly', 'part');
    assert.equal(s.opacity('whole'), 0.5);
    assert.equal(s.opacity('part'), undefined);
  });

  it('matches how the list starts with ^= and how it ends with $=', () => {
    const s = scene('[class^="icon-"] { opacity: 0.5 } [class$="-end"] { opacity: 0.25 }');
    s.add('icon-star big', 'first');
    s.add('big icon-star', 'second');
    s.add('a b-end', 'last');
    assert.equal(s.opacity('first'), 0.5);
    assert.equal(s.opacity('second'), undefined);
    assert.equal(s.opacity('last'), 0.25);
  });

  it('matches [class] on an element with a class and not on one with none', () => {
    const s = scene('[class] { opacity: 0.5 }');
    s.add('any', 'classed');
    s.add('', 'bare');
    assert.equal(s.opacity('classed'), 0.5);
    assert.equal(s.opacity('bare'), undefined);
  });

  it('stops a :not() matching an element whose class says what it excludes', () => {
    const s = scene('view:not([class*="size-"]) { opacity: 0.5 }');
    s.add('size-4', 'sized');
    s.add('other', 'unsized');
    assert.equal(s.opacity('sized'), undefined);
    assert.equal(s.opacity('unsized'), 0.5);
  });

  it('follows a class added and removed after the first commit', () => {
    const s = scene('[class*="anim"] .cell { opacity: 0.5 }');
    const panel = s.add('panel', 'panel');
    s.add('cell', 'cell', panel);
    assert.equal(s.opacity('cell'), undefined);
    s.engine.addClass(panel, 'animating');
    assert.equal(s.opacity('cell'), 0.5);
    s.engine.removeClass(panel, 'animating');
    assert.equal(s.opacity('cell') ?? 1, 1);
  });

  it('follows the same classes set again in another order', () => {
    const s = scene('[class^="first"] { opacity: 0.5 }');
    const node = s.add('first second', 'node');
    assert.equal(s.opacity('node'), 0.5);
    s.engine.setClasses(node, 'second first');
    assert.equal(s.opacity('node') ?? 1, 1);
    s.engine.setClasses(node, 'first second');
    assert.equal(s.opacity('node'), 0.5);
  });
});
