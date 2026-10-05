/**
 * A sheet added while the app runs: a component whose CSS is not scoped renders for the first
 * time, and its rules can match anything. Only what they could match is styled again. Styling
 * everything again is the same answer, and the time a screen of views takes it is what a menu
 * opening for the first time was waiting for.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { styleStats } from '../fabric/src/css.ts';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const sheet = (css: string) => compileCss(css, 'added.css') as StyleSheet;

function scene() {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: sheet('.row { height: 10px } .label { color: var(--ink, black) }'),
  });
  const add = (name: string, classes: string, parent: EngineNode) => {
    const node = engine.createElement(name);
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', classes);
    engine.appendChild(parent, node);
    return node;
  };
  const list = add('view', 'list', engine.root);
  for (let i = 0; i < 20; i++) add('text', 'label', add('view', 'row', list));
  const panel = add('view', 'panel', engine.root);
  add('text', 'label inside', panel);
  engine.commit();
  const props = (id: string): Record<string, unknown> => {
    const find = (all: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const each of all) {
        const found = each.props['nativeID'] === id ? each : find(each.children);
        if (found) return found;
      }
      return undefined;
    };
    return find(fabric.committed)!.props;
  };
  /** How many nodes a commit styles again. */
  const styled = (change: () => void): number => {
    const before = styleStats.nodesResolved;
    change();
    engine.commit();
    return styleStats.nodesResolved - before;
  };
  return { engine, props, styled, panel };
}

describe('a global sheet added while the app runs', () => {
  it('styles nothing again where none of its rules could match', () => {
    const s = scene();
    assert.equal(
      s.styled(() => s.engine.addGlobalSheet(sheet('.overlay { position: absolute }'))),
      0,
    );
  });

  it('styles nothing again for a sheet that names a layer, which the CDK does for an overlay', () => {
    const s = scene();
    const layered = '@layer cdk-overlay { .overlay { position: absolute } }';
    assert.equal(
      s.styled(() => s.engine.addGlobalSheet(sheet(layered))),
      0,
    );
    // And a layer is still under what is in none, for what the sheet does match.
    s.engine.addGlobalSheet(sheet('@layer late { .panel { opacity: 0.2 } } .panel { top: 3px }'));
    s.engine.addGlobalSheet(sheet('.panel { opacity: 0.7 }'));
    s.engine.commit();
    assert.equal(s.props('panel')['opacity'], 0.7);
    assert.equal(s.props('panel')['top'], 3);
  });

  it('styles nothing more again where views arrive with the sheet, as an overlay does', () => {
    // The first menu to open: its views join the tree and its sheet is added in one commit.
    // Where a rule asks what an element holds, every view over the new ones is asked again, the
    // root among them, and one styled again takes all under it with it.
    const s = scene();
    s.engine.addGlobalSheet(sheet('.list:has(.never) { top: 1px }'));
    s.engine.commit();
    const count = s.styled(() => {
      const overlay = s.engine.createElement('view');
      s.engine.setClasses(overlay, 'overlay');
      s.engine.appendChild(s.engine.root, overlay);
      s.engine.addGlobalSheet(sheet('@layer cdk-overlay { .overlay { position: absolute } }'));
    });
    assert.ok(count <= 2, `${count} nodes styled, of the forty there already`);
  });

  it('styles nothing again for a rule for anything inside a box that is nowhere', () => {
    // `.dialog-content > :first-child`: written for any element, but only one in such a box.
    const s = scene();
    const inside =
      '.dialog > :first-child { top: 4px } .dialog :last-child { left: 5px } .dialog > text { top: 1px }';
    assert.equal(
      s.styled(() => s.engine.addGlobalSheet(sheet(inside))),
      0,
    );
  });

  it('styles what is inside such a box, where there is one', () => {
    const s = scene();
    s.engine.addGlobalSheet(
      sheet(
        '.panel > :first-child { top: 4px } .panel :last-child { left: 5px } .panel > text { right: 6px }',
      ),
    );
    s.engine.commit();
    assert.equal(s.props('label inside')['top'], 4);
    assert.equal(s.props('label inside')['left'], 5);
    assert.equal(s.props('label inside')['right'], 6);
    // What comes after a box is not in it: a rule by a sibling is for anything.
    const after = s.styled(() => s.engine.addGlobalSheet(sheet('.never + * { top: 9px }')));
    assert.ok(after > 20, `${after} nodes styled`);
  });

  it('styles again what a rule of it is written for, and that matches', () => {
    const s = scene();
    const count = s.styled(() => s.engine.addGlobalSheet(sheet('.panel { opacity: 0.5 }')));
    assert.equal(s.props('panel')['opacity'], 0.5);
    // The panel and what is in it, which inherits from it: not the twenty rows beside it.
    assert.ok(count >= 1 && count <= 2, `${count} nodes styled`);
  });

  it('matches by what is above a node as well', () => {
    const s = scene();
    s.engine.addGlobalSheet(sheet('.panel .inside { font-size: 30px } text.label { top: 1px }'));
    s.engine.commit();
    assert.equal(s.props('label inside')['fontSize'], 30);
    assert.equal(s.props('label inside')['top'], 1);
  });

  it('reaches what reads a token the sheet sets further up', () => {
    const s = scene();
    s.engine.addGlobalSheet(sheet('.panel { --ink: rgb(1, 2, 3) }'));
    s.engine.commit();
    assert.equal(s.props('label inside')['color'], 'rgb(1, 2, 3)');
  });

  it('reaches a node that is given the class afterwards', () => {
    const s = scene();
    s.engine.addGlobalSheet(sheet('.late { opacity: 0.25 }'));
    s.engine.commit();
    s.engine.setClasses(s.panel, 'panel late');
    s.engine.commit();
    assert.equal(s.props('panel')['opacity'], 0.25);
  });

  it('styles everything again when a sheet is taken away', () => {
    const s = scene();
    const added = sheet('.panel { opacity: 0.5 }');
    s.engine.addGlobalSheet(added);
    s.engine.commit();
    assert.ok(s.styled(() => s.engine.removeGlobalSheet(added)) > 20);
    assert.equal(s.props('panel')['opacity'] ?? null, null);
  });
});
