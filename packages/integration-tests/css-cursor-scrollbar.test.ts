/**
 * `cursor` and the scroll bar properties, which a desktop host draws.
 *
 * React Native's `cursor` has two values, `auto` and `pointer`, which iOS draws for an iPad's
 * pointer. Every other CSS cursor reaches the host as `desktopCursor`, the keyword as written,
 * beside the nearest of those two in `cursor`. `scrollbar-width` and `scrollbar-gutter` reach it
 * as `scrollbarWidth` and `scrollbarGutter`, and `scrollbar-width: none` hides the indicators of a
 * scroll view on iOS and Android too.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const compiled = (css: string) => {
  const warnings: string[] = [];
  const sheet = compileCss(css, 'app.css', { onUnsupported: (m: string) => warnings.push(m) });
  return { declarations: sheet.rules[0]?.declarations, warnings };
};

describe('cursor', () => {
  it('keeps auto, default and pointer as React Native reads them', () => {
    assert.deepEqual(compiled('.a { cursor: pointer }').declarations, { cursor: 'pointer' });
    assert.deepEqual(compiled('.a { cursor: default }').declarations, { cursor: 'auto' });
    assert.deepEqual(compiled('.a { cursor: auto }').declarations, { cursor: 'auto' });
  });

  it('hands every other CSS cursor to the desktop host, and auto to the others', () => {
    for (const keyword of [
      'text',
      'not-allowed',
      'grab',
      'grabbing',
      'move',
      'crosshair',
      'help',
      'wait',
      'progress',
      'col-resize',
      'row-resize',
      'ew-resize',
      'ns-resize',
      'nwse-resize',
      'zoom-in',
      'zoom-out',
      'none',
      'copy',
      'context-menu',
    ]) {
      assert.deepEqual(
        compiled(`.a { cursor: ${keyword} }`).declarations,
        { cursor: 'auto', desktopCursor: keyword },
        keyword,
      );
    }
  });

  it('refuses an image cursor, naming the keywords it takes', () => {
    const { declarations, warnings } = compiled('.a { cursor: url(hand.png), pointer }');
    assert.equal(declarations, undefined);
    assert.match(warnings[0]!, /cursor/);
  });
});

describe('scroll bars', () => {
  it('hides the indicators for scrollbar-width: none, and tells the host', () => {
    assert.deepEqual(compiled('.a { scrollbar-width: none }').declarations, {
      scrollbarWidth: 'none',
      showsVerticalScrollIndicator: false,
      showsHorizontalScrollIndicator: false,
    });
  });

  it('shows them again for auto, and hands thin to the host', () => {
    assert.deepEqual(compiled('.a { scrollbar-width: auto }').declarations, {
      scrollbarWidth: 'auto',
      showsVerticalScrollIndicator: true,
      showsHorizontalScrollIndicator: true,
    });
    assert.deepEqual(compiled('.a { scrollbar-width: thin }').declarations, {
      scrollbarWidth: 'thin',
      showsVerticalScrollIndicator: true,
      showsHorizontalScrollIndicator: true,
    });
  });

  it('hands scrollbar-gutter: stable to the host', () => {
    assert.deepEqual(compiled('.a { scrollbar-gutter: stable }').declarations, {
      scrollbarGutter: 'stable',
    });
    assert.deepEqual(compiled('.a { scrollbar-gutter: auto }').declarations, {
      scrollbarGutter: 'auto',
    });
  });

  it('drops ::-webkit-scrollbar, naming scrollbar-width', () => {
    const { warnings } = compiled('.a::-webkit-scrollbar { display: none }');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /::-webkit-scrollbar/);
    assert.match(warnings[0]!, /scrollbar-width/);
  });
});

describe('on the committed view', () => {
  const committed = (css: string, element = 'view') => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as StyleSheet });
    const box = engine.createElement(element);
    engine.setClasses(box, 'a');
    engine.appendChild(box, engine.createElement('view'));
    engine.appendChild(engine.root, box);
    engine.commit();
    const all: FakeFabricNode[] = [];
    const walk = (nodes: readonly FakeFabricNode[]) =>
      nodes.forEach((n) => (all.push(n), walk(n.children)));
    walk(fabric.committed);
    return all;
  };

  it('commits the cursor for the host', () => {
    const view = committed('.a { cursor: grab }').find((n) => 'desktopCursor' in n.props);
    assert.equal(view?.props['desktopCursor'], 'grab');
    assert.equal(view?.props['cursor'], 'auto');
  });

  it('hides the indicators of a scroll view, on the scroll view', () => {
    const scroller = committed('.a { scrollbar-width: none }', 'scroll-view').find(
      (n) => n.viewName === 'ScrollView',
    );
    assert.equal(scroller?.props['showsVerticalScrollIndicator'], false);
    assert.equal(scroller?.props['scrollbarWidth'], 'none');
  });
});
