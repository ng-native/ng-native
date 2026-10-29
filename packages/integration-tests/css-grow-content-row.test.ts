/**
 * An item that grows, in a row as wide as its content: `align-self: flex-start` in a column. A
 * browser sizes the row by what its items hold, and a share of the room left over is a share of
 * none. React Native's Yoga gives the row all the room it could have where any item grows, so a
 * tray of tabs that share it evenly fills the screen. The engine fits such a row to its content,
 * with the items' growth set aside, and commits it at that width.
 *
 * Chrome lays every case here out at the width of the text, the same markup in a 362 pixel column.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import type { Type } from '@angular/core';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { mount } from '@ng-native/platform';
import { settle } from '@ng-native/testing';
import { compileSource } from './compile.ts';
import { createLaidOutFabric } from './laid-out-fabric.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const CASES = ['flex: 1 1 auto', '', 'flex-grow: 1', 'flex: 1'];
/** Seven characters, at ten points each. */
const WORD = 'abcdefg';
const CONTENT = 70;
const CONFORMANCES = ['classic', 'strict'] as const;

/** A column of rows, each holding one item with one of the cases on it, by a class. */
function sheetScene(conformance: (typeof CONFORMANCES)[number]) {
  const css =
    '.col { width: 362px } .row { flex-direction: row; align-self: flex-start } ' +
    '.stretch { align-self: stretch } ' +
    CASES.map((declaration, i) => `.c${i} { ${declaration} }`).join(' ');
  const fabric = createLaidOutFabric(conformance);
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css, 'app.css') as never,
    ...(conformance === 'strict' ? { layoutConformance: 'strict' as const } : {}),
  });
  const element = (classes: string, id: string, parent: EngineNode) => {
    const node = engine.createElement('view');
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', id);
    engine.appendChild(parent, node);
    return node;
  };
  const col = element('col', 'col', engine.root);
  const rows: EngineNode[] = [];
  const items: EngineNode[] = [];
  CASES.forEach((_, i) => {
    rows.push(element('row', `row${i}`, col));
    items.push(element(`c${i}`, `item${i}`, rows[i]!));
    const text = engine.createElement('text');
    engine.appendChild(text, engine.createText(WORD));
    engine.appendChild(items[i]!, text);
  });
  const width = (id: string) => {
    engine.commit();
    return fabric.box(id).width;
  };
  return { engine, rows, items, width };
}

describe('a row as wide as its content, with an item that grows', () => {
  for (const conformance of CONFORMANCES) {
    it(`is as wide as what it holds, by a class (${conformance})`, () => {
      const s = sheetScene(conformance);
      CASES.forEach((declaration, i) => {
        assert.equal(s.width(`row${i}`), CONTENT, `row with ${declaration || 'no flex'}`);
        assert.equal(s.width(`item${i}`), CONTENT, `item with ${declaration || 'no flex'}`);
      });
    });
  }

  it('fills the column once it is stretched across it, and fits again once it is not', () => {
    const s = sheetScene('classic');
    for (const [i, row] of s.rows.entries()) s.engine.setClasses(row, 'row stretch');
    CASES.forEach((declaration, i) => {
      assert.equal(s.width(`row${i}`), 362, `row with ${declaration || 'no flex'}`);
      // The item's share of the row is all of it, where it grows.
      assert.equal(s.width(`item${i}`), declaration ? 362 : CONTENT, declaration || 'no flex');
    });
    for (const row of s.rows) s.engine.setClasses(row, 'row');
    CASES.forEach((declaration, i) => {
      assert.equal(s.width(`row${i}`), CONTENT, `row with ${declaration || 'no flex'}`);
    });
  });

  it('follows its item starting to grow after it was laid out, and stopping', () => {
    const s = sheetScene('classic');
    const plain = s.items[1]!;
    assert.equal(s.width('row1'), CONTENT);
    s.engine.setClasses(plain, 'c2');
    assert.equal(s.width('row1'), CONTENT, 'flex-grow: 1 set after the first layout');
    assert.equal(s.width('item1'), CONTENT);
    s.engine.setClasses(plain, '');
    assert.equal(s.width('row1'), CONTENT);
    // What the row holds getting wider still widens it.
    const text = s.engine.createElement('text');
    s.engine.appendChild(text, s.engine.createText('hijklmnopq'));
    s.engine.appendChild(s.items[2]!, text);
    assert.equal(s.width('row2'), 100);
  });

  /** One row in a 362 point column, as wide as its content, holding one item set up by `item`. */
  function oneRow(css: string, item: (engine: Engine, node: EngineNode) => void) {
    const fabric = createLaidOutFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
    const col = engine.createElement('view');
    engine.setProp(col, 'style', { width: 362 });
    engine.appendChild(engine.root, col);
    const row = engine.createElement('view');
    engine.setProp(row, 'nativeID', 'row');
    engine.setProp(row, 'style', { flexDirection: 'row', alignSelf: 'flex-start' });
    engine.appendChild(col, row);
    const node = engine.createElement('view');
    engine.appendChild(row, node);
    const text = engine.createElement('text');
    engine.appendChild(text, engine.createText(WORD));
    engine.appendChild(node, text);
    item(engine, node);
    engine.commit();
    return { fabric, engine, row, node };
  }

  it("is as wide as what it holds where the item grows by React Native's own flex", () => {
    // Nothing else in the app asks for a share: the item's flex alone does.
    const { fabric } = oneRow('', (engine, node) => engine.setProp(node, 'style', { flex: 1 }));
    assert.equal(fabric.box('row').width, CONTENT);
  });

  it('is as wide as what it holds where the item grows by a token', () => {
    const css = ':root { --grow: 1 } .grow { flex-grow: var(--grow) }';
    const { fabric } = oneRow(css, (engine, node) => engine.setClasses(node, 'grow'));
    assert.equal(fabric.box('row').width, CONTENT);
  });

  it('is not fitted for an item that grows down a column, which takes no room across', () => {
    const { fabric, engine, node } = oneRow('', (e, item) => {
      e.setProp(item.parent!, 'style', { flexDirection: 'column', alignSelf: 'flex-start' });
    });
    const before = fabric.calls.completeRoot;
    engine.setProp(node, 'style', { flexGrow: 1 });
    engine.commit();
    assert.equal(fabric.box('row').width, CONTENT);
    assert.equal(fabric.calls.completeRoot - before, 1, 'one commit, and none to fit it');
  });
});

describe('a row as wide as its content, with an item that grows by its style attribute', () => {
  for (const conformance of CONFORMANCES) {
    it(`is as wide as what it holds (${conformance})`, async () => {
      const rows = CASES.map(
        (declaration, i) =>
          `<view nativeID="row${i}" style="flex-direction: row; align-self: flex-start"><view nativeID="item${i}" style="${declaration}"><text>${WORD}</text></view></view>`,
      ).join('');
      const file = path.join(import.meta.dirname, `css-grow-content-row-${conformance}.fixture.ts`);
      const mod = await compileSource(
        `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
import { Text } from '../components/src/text.ts';
@Component({
  selector: 'x-grow-${conformance}',
  imports: [View, Text],
  template: '<view style="width: 362px">${rows}</view>',
})
export class Rows {}
`,
        file,
        file.replace(/\.ts$/, '.generated.ts'),
      );
      const fabric = createLaidOutFabric(conformance);
      const app = mount(1, mod['Rows'] as Type<unknown>, fabric, {
        ...(conformance === 'strict' ? { layoutConformance: 'strict' as const } : {}),
      });
      try {
        await settle();
        CASES.forEach((declaration, i) => {
          assert.equal(
            fabric.box(`row${i}`).width,
            CONTENT,
            `row with ${declaration || 'no flex'}`,
          );
        });
      } finally {
        app.applicationRef.destroy();
      }
    });
  }
});
