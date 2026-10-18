/**
 * `position: fixed`, which Yoga has no viewport for. A fixed box is positioned against the page
 * it is on: the screen or modal it is inside, or else the whole app.
 *
 * It stays where it is in the tree, out of the flow, so it paints in the order it is written in
 * and takes its ancestors' opacity, as it does in a browser. The engine works out from sizes
 * read back from Fabric where the page is from there, and commits its insets against whatever
 * Yoga positions it by. Only when something between it and its page scrolls or clips is it
 * committed under the page instead, where neither reaches it; it is still styled, and its events
 * still bubble, as its parent's child.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import {
  Engine,
  registerPlatformComponents,
  registerViewName,
  type EngineNode,
} from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { createLaidOutFabric } from './laid-out-fabric.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

type Spec = [name: string, ...children: Spec[]];

function scene(css: string, spec: Spec) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const nodes = new Map<string, EngineNode>();
  const build = ([name, ...children]: Spec, parent: EngineNode): EngineNode => {
    // `scroll` and `page` are elements of those kinds, and anything else a view of that class.
    const element = { scroll: 'scroll-view', page: 'fixed-test-page' }[name] ?? 'view';
    const node = engine.createElement(element);
    engine.setClasses(node, name);
    engine.setProp(node, 'nativeID', name);
    engine.appendChild(parent, node);
    nodes.set(name, node);
    for (const child of children) build(child, node);
    return node;
  };
  build(spec, engine.root);
  /** The committed tree as nested names, which is where each view is on the native side. */
  const tree = (): unknown[] => {
    engine.commit();
    // Through the view a page's fixed boxes are committed in, which has no name: see below.
    const walk = (all: FakeFabricNode[]): unknown[] =>
      all.flatMap((node) =>
        node.props['nativeID'] === undefined
          ? walk(node.children)
          : [[String(node.props['nativeID']), ...walk(node.children)]],
      );
    return walk(fabric.committed);
  };
  const props = (name: string): Record<string, unknown> => {
    engine.commit();
    const find = (all: FakeFabricNode[]): FakeFabricNode | undefined =>
      all
        .flatMap((node) => (node.props['nativeID'] === name ? [node] : [find(node.children)]))
        .find(Boolean);
    return find(fabric.committed)!.props;
  };
  return { engine, fabric, nodes, build, tree, props };
}

const FIXED =
  '.bar { position: fixed; top: 0; left: 0; right: 0; height: 40px } .plain { position: relative }';

describe('position: fixed', () => {
  before(() => registerViewName('fixed-test-page', 'RNSScreen'));
  after(() => registerViewName('fixed-test-page', 'View'));

  it('commits the box at the root, after the app, and not inside the scroll view it is written in', () => {
    const s = scene(FIXED, ['app', ['scroll', ['content', ['bar'], ['row']]]]);
    assert.deepEqual(s.tree(), [['app', ['scroll', ['content', ['row']]]], ['bar']]);
  });

  it('is committed in a view over the whole page that lets touches through, which clips it by nothing', () => {
    // Android's screen view clips each view in it to that view's bounds, where a toaster of no
    // height draws its toasts above itself. A React Native view clips by nothing.
    const s = scene(FIXED, ['page', ['scroll', ['bar']], ['other']]);
    s.engine.commit();
    const [page] = s.fabric.committed;
    const layer = page!.children.at(-1)!;
    assert.equal(layer.props['nativeID'], undefined);
    assert.equal(layer.viewName, 'View');
    const { position, top, left, right, bottom, pointerEvents } = layer.props;
    assert.deepEqual(
      [position, top, left, right, bottom, pointerEvents],
      ['absolute', 0, 0, 0, 0, 'box-none'],
    );
    assert.deepEqual(
      layer.children.map((node) => node.props['nativeID']),
      ['bar'],
    );
    // The same view the next commit, with what changed in it.
    s.engine.setProp(s.nodes.get('bar')!, 'style', { height: 50 });
    s.engine.commit();
    assert.equal(s.fabric.committed[0]!.children.at(-1)!.reactTag, layer.reactTag);
  });

  it('is committed in that view on Android wherever it is, which clips each view by its bounds', () => {
    // A toaster of no height, in a box a library puts in the page, with its toasts above it.
    registerPlatformComponents('android');
    try {
      for (const spec of [
        ['page', ['body', ['bar']], ['content']],
        ['app', ['body', ['bar']]],
      ] as Spec[]) {
        const s = scene(FIXED, spec);
        // In one place in each tree committed: Android refuses a view put where it already is.
        const { completeRoot } = s.fabric;
        s.fabric.completeRoot = (tag, set) => {
          const seen = new Set<number>();
          const walk = (all: FakeFabricNode[]): void =>
            all.forEach((node) => {
              assert.ok(!seen.has(node.reactTag), `${String(node.props['nativeID'])} twice`);
              seen.add(node.reactTag);
              walk(node.children);
            });
          walk(set as FakeFabricNode[]);
          completeRoot(tag, set);
        };
        const expected =
          spec[0] === 'page'
            ? [['page', ['body'], ['content'], ['bar']]]
            : [['app', ['body']], ['bar']];
        assert.deepEqual(s.tree(), expected);
      }
    } finally {
      registerPlatformComponents('ios');
    }
    const s = scene(FIXED, ['page', ['body', ['bar']], ['content']]);
    assert.deepEqual(s.tree(), [['page', ['body', ['bar']], ['content']]]);
  });

  it('stays under its parent, out of the flow, where nothing scrolls or clips it', () => {
    const s = scene(FIXED, ['app', ['box', ['bar'], ['row']]]);
    assert.deepEqual(s.tree(), [['app', ['box', ['bar'], ['row']]]]);
    const props = s.props('bar');
    assert.equal(props['position'], 'absolute');
    assert.deepEqual([props['top'], props['left'], props['right'], props['height']], [0, 0, 0, 40]);
  });

  it('is committed under its page when an ancestor clips, as when one scrolls', () => {
    const s = scene(`${FIXED} .clip { overflow: hidden }`, ['app', ['clip', ['bar']]]);
    assert.deepEqual(s.tree(), [['app', ['clip']], ['bar']]);
    assert.equal(s.props('bar')['position'], 'absolute');
  });

  it('pins it to the screen it is on, where it is on one', () => {
    const s = scene(FIXED, ['app', ['page', ['scroll', ['bar']], ['row']]]);
    assert.deepEqual(s.tree(), [['app', ['page', ['scroll'], ['row'], ['bar']]]]);
  });

  it('settles in the commit it appears in, with no pass left over', () => {
    const s = scene(FIXED, ['app', ['scroll', ['bar']]]);
    assert.equal(s.engine.commit(), true);
    assert.equal(s.engine.commit(), false);
  });

  it('goes back under its parent when it stops being fixed', () => {
    const s = scene(FIXED, ['app', ['scroll', ['bar']]]);
    assert.deepEqual(s.tree(), [['app', ['scroll']], ['bar']]);
    s.engine.setClasses(s.nodes.get('bar')!, 'plain');
    assert.deepEqual(s.tree(), [['app', ['scroll', ['bar']]]]);
    assert.equal(s.props('bar')['position'], 'relative');
  });

  it('is taken out from under its parent when it becomes fixed', () => {
    const s = scene(FIXED, ['app', ['scroll', ['late']]]);
    assert.deepEqual(s.tree(), [['app', ['scroll', ['late']]]]);
    s.engine.setClasses(s.nodes.get('late')!, 'bar');
    assert.deepEqual(s.tree(), [['app', ['scroll']], ['late']]);
  });

  it('stays under its parent while a finger is on it, and is taken out when the finger lifts', () => {
    // A view that is moved loses its touch, and a library that drags an element makes it fixed
    // to hide it as the drag begins, with the finger still on it.
    const s = scene(FIXED, ['app', ['scroll', ['bar']]]);
    const bar = s.nodes.get('bar')!;
    s.engine.setClasses(bar, '');
    const point = { identifier: 0, pageX: 10, pageY: 10 };
    s.engine.dispatchEvent(bar, 'topTouchStart', { ...point, touches: [point] });
    s.engine.setClasses(bar, 'bar');
    assert.deepEqual(s.tree(), [['app', ['scroll', ['bar']]]]);
    s.engine.dispatchEvent(bar, 'topTouchEnd', { ...point, touches: [] });
    assert.deepEqual(s.tree(), [['app', ['scroll']], ['bar']]);
  });

  it('is taken out at once with a finger on something else', () => {
    const s = scene(FIXED, ['app', ['scroll', ['bar']], ['plain']]);
    const bar = s.nodes.get('bar')!;
    s.engine.setClasses(bar, '');
    const point = { identifier: 0, pageX: 10, pageY: 10 };
    s.engine.dispatchEvent(s.nodes.get('plain')!, 'topTouchStart', { ...point, touches: [point] });
    s.engine.setClasses(bar, 'bar');
    assert.deepEqual(s.tree(), [['app', ['scroll'], ['plain']], ['bar']]);
  });

  it('leaves the root when it is removed, and when what holds it is', () => {
    const css = `${FIXED} .box { overflow: hidden }`;
    const s = scene(css, ['app', ['scroll', ['bar']], ['box', ['bar two']]]);
    assert.deepEqual(s.tree(), [['app', ['scroll'], ['box']], ['bar'], ['bar two']]);
    s.engine.removeChild(s.nodes.get('scroll')!, s.nodes.get('bar')!);
    assert.deepEqual(s.tree(), [['app', ['scroll'], ['box']], ['bar two']]);
    s.engine.removeChild(s.nodes.get('app')!, s.nodes.get('box')!);
    assert.deepEqual(s.tree(), [['app', ['scroll']]]);
  });

  it('keeps its own children, and follows a change to one', () => {
    const s = scene(`${FIXED} .wide { width: 50px }`, ['app', ['scroll', ['bar', ['label']]]]);
    assert.deepEqual(s.tree(), [
      ['app', ['scroll']],
      ['bar', ['label']],
    ]);
    s.engine.setClasses(s.nodes.get('label')!, 'wide');
    assert.equal(s.props('label')['width'], 50);
  });

  it('is styled as the child of its parent that it is written as', () => {
    const css = `${FIXED} .dark { overflow: hidden } .dark > .bar { opacity: 0.5 }`;
    const s = scene(css, ['app', ['dark', ['bar']]]);
    assert.equal(s.props('bar')['opacity'], 0.5);
  });

  it('bubbles its events to the parent it is written in', () => {
    const s = scene(FIXED, ['app', ['scroll', ['bar']]]);
    s.tree();
    let heard = 0;
    s.engine.setEventListener(s.nodes.get('scroll')!, 'topTouchEnd', () => heard++);
    const find = (all: FakeFabricNode[]): FakeFabricNode | undefined =>
      all
        .flatMap((node) => (node.props['nativeID'] === 'bar' ? [node] : [find(node.children)]))
        .find(Boolean);
    s.fabric.emit(find(s.fabric.committed)!, 'topTouchEnd', { touches: [], changedTouches: [] });
    assert.equal(heard, 1);
  });

  it('is fixed by a position bound on the element, as by one in a stylesheet', () => {
    const s = scene('.x { height: 10px }', ['app', ['scroll', ['x']]]);
    assert.deepEqual(s.tree(), [['app', ['scroll', ['x']]]]);
    s.engine.setProp(s.nodes.get('x')!, 'style', { position: 'fixed', top: 0 });
    assert.deepEqual(s.tree(), [['app', ['scroll']], ['x']]);
    assert.equal(s.props('x')['position'], 'absolute');
    s.engine.setProp(s.nodes.get('x')!, 'style', undefined);
    assert.deepEqual(s.tree(), [['app', ['scroll', ['x']]]]);
  });

  it('is not shown while something it is inside is not displayed, as in a browser', () => {
    const css = `${FIXED} .gone { display: none }`;
    const s = scene(css, ['app', ['wrap', ['scroll', ['bar']]]]);
    assert.deepEqual(s.tree(), [['app', ['wrap', ['scroll']]], ['bar']]);
    s.engine.setClasses(s.nodes.get('wrap')!, 'gone');
    // Nor is the box it is inside, or anything else in that.
    assert.deepEqual(s.tree(), [['app']]);
    s.engine.setClasses(s.nodes.get('wrap')!, 'wrap');
    assert.deepEqual(s.tree(), [['app', ['wrap', ['scroll']]], ['bar']]);
  });

  it('takes no part in the flow of a block it is written in', () => {
    const css = `${FIXED} .p { display: block } .a { margin-bottom: 20px } .b { margin-top: 10px }`;
    const s = scene(css, ['app', ['p', ['a'], ['bar'], ['b']]]);
    assert.equal(s.props('b')['marginTop'], 20);
  });
});

describe('a fixed box that stays in place', () => {
  const PAGE = { width: 400, height: 800 };
  const OFF = '.off { margin-top: 100px; margin-left: 50px; width: 200px; height: 200px }';

  function laidOut(css: string, spec: Spec) {
    const fabric = createLaidOutFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(css, 'app.css') as never,
      conditions: { ...PAGE, colorScheme: 'light' },
    });
    const nodes = new Map<string, EngineNode>();
    const build = ([name, ...children]: Spec, parent: EngineNode): void => {
      const node = engine.createElement('view');
      engine.setClasses(node, name);
      engine.setProp(node, 'nativeID', name);
      engine.appendChild(parent, node);
      nodes.set(name, node);
      for (const child of children) build(child, node);
    };
    build(spec, engine.root);
    const box = (name: string) => {
      engine.commit();
      const { left, top, width, height } = fabric.box(name);
      return [left, top, width, height];
    };
    return { engine, nodes, box };
  }

  it('is placed against the screen, not the box it is written in', () => {
    const css = `${OFF} .bar { position: fixed; top: 10px; left: 0; right: 0; height: 40px }`;
    assert.deepEqual(laidOut(css, ['off', ['bar']]).box('bar'), [0, 10, 400, 40]);
  });

  it('is placed against the screen in a grid, and not in an area of the grid', () => {
    // Chrome: 50 over the bottom of the screen, 10 in from its left.
    const css =
      '.w { padding: 20px } .g { display: grid } .f { position: fixed; bottom: 50px; left: 10px; width: 10px; height: 10px }';
    assert.deepEqual(laidOut(css, ['w', ['g', ['f']]]).box('f'), [10, 740, 10, 10]);
  });

  it('measures right and bottom from the screen too', () => {
    const css = `${OFF} .c { position: fixed; right: 16px; bottom: 20px; width: 50px; height: 30px }`;
    assert.deepEqual(laidOut(css, ['off', ['c']]).box('c'), [334, 750, 50, 30]);
  });

  it('takes a percentage of the screen', () => {
    const css = `${OFF} .w { position: fixed; top: 25%; left: 0; width: 50%; height: 10px }`;
    assert.deepEqual(laidOut(css, ['off', ['w']]).box('w'), [0, 200, 200, 10]);
  });

  it('is centred on the screen by auto margins between insets', () => {
    const css = `${OFF} .m { position: fixed; inset: 0; margin: auto; width: 100px; height: 60px }`;
    assert.deepEqual(laidOut(css, ['off', ['m']]).box('m'), [150, 370, 100, 60]);
  });

  it('follows the box it is written in moving', () => {
    const css = `${OFF} .moved { margin-top: 300px; margin-left: 0; width: 200px; height: 200px } .bar { position: fixed; top: 10px; left: 0; right: 0; height: 40px }`;
    const s = laidOut(css, ['off', ['bar']]);
    assert.deepEqual(s.box('bar'), [0, 10, 400, 40]);
    s.engine.setClasses(s.nodes.get('off')!, 'moved');
    assert.deepEqual(s.box('bar'), [0, 10, 400, 40]);
  });

  it('settles in the commit it was changed in, with no pass left over', () => {
    const css = `${OFF} .bar { position: fixed; top: 10px; left: 0; right: 0; height: 40px }`;
    const s = laidOut(css, ['off', ['bar']]);
    assert.equal(s.engine.commit(), true);
    assert.equal(s.engine.commit(), false);
  });
});

describe('an absolute box placed against a box further up than its parent', () => {
  // A chip's outline: drawn by a box in the chip's action, which is not positioned, so it is
  // placed against the chip and is as wide as the chip. The action clips, and a browser clips
  // only what is placed against the box that clips or against something in it.
  const CHIP =
    '.chip { position: relative; flex-direction: row } .action { position: static } ' +
    '.ring { position: absolute; left: 0; top: 0; width: 100%; height: 100% } ' +
    '.clips { overflow: hidden } .placed { position: relative }';
  const chip = (action = 'action clips') => {
    const s = scene(CHIP, ['chip', ['action', ['ring'], ['label']], ['trail']]);
    s.engine.setClasses(s.nodes.get('action')!, action);
    return s;
  };

  it('is committed under the box it is placed against, where its parent clips', () => {
    assert.deepEqual(chip().tree(), [['chip', ['action', ['label']], ['trail'], ['ring']]]);
  });

  it('stays under its parent where nothing between the two clips', () => {
    assert.deepEqual(chip('action').tree(), [['chip', ['action', ['ring'], ['label']], ['trail']]]);
  });

  it('stays under a parent that is positioned, which is what it is placed against', () => {
    const s = chip('action clips placed');
    assert.deepEqual(s.tree(), [['chip', ['action', ['ring'], ['label']], ['trail']]]);
  });

  it('follows its parent starting to clip and stopping, and itself coming into the flow', () => {
    const s = chip('action');
    s.tree();
    s.engine.setClasses(s.nodes.get('action')!, 'action clips');
    assert.deepEqual(s.tree(), [['chip', ['action', ['label']], ['trail'], ['ring']]]);
    s.engine.setClasses(s.nodes.get('action')!, 'action');
    assert.deepEqual(s.tree(), [['chip', ['action', ['ring'], ['label']], ['trail']]]);
    s.engine.setClasses(s.nodes.get('action')!, 'action clips');
    s.tree();
    s.engine.setClasses(s.nodes.get('ring')!, '');
    assert.deepEqual(s.tree(), [['chip', ['action', ['ring'], ['label']], ['trail']]]);
  });

  it('goes with its parent when the parent is taken away', () => {
    const s = chip();
    s.tree();
    s.engine.removeChild(s.nodes.get('chip')!, s.nodes.get('action')!);
    assert.deepEqual(s.tree(), [['chip', ['trail']]]);
  });
});
