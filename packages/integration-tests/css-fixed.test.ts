/**
 * `position: fixed`, which Yoga has no viewport for. A fixed box is positioned against the page
 * it is on: the screen or modal it is inside, or else the whole app.
 *
 * It stays where it is in the tree, out of the flow, so it paints in the order it is written in
 * and takes its ancestors' opacity, as it does in a browser. The engine works out from sizes
 * read back from Fabric where the page is from there, and commits its insets against whatever
 * Yoga positions it by. Only when something between it and its page scrolls or clips, or it is as
 * wide as its content, is it committed under the page instead, where neither reaches it and its
 * text wraps in the page; it is still styled, and its events still bubble, as its parent's child.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import {
  Engine,
  markPage,
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

  it('pins it to a screen that wraps its children beside the wrapper, and not in it', () => {
    const s = scene(FIXED, ['app', ['page', ['scroll', ['bar']], ['row']]]);
    s.engine.wrapChildren(s.nodes.get('page')!, { viewName: 'View', props: { nativeID: 'in' } });
    assert.deepEqual(s.tree(), [['app', ['page', ['in', ['scroll'], ['row']], ['bar']]]]);
  });

  it('lets the page go with what is fixed to it when the page leaves the tree', () => {
    const s = scene(FIXED, ['app', ['page', ['scroll', ['bar']], ['row']]]);
    s.tree();
    const fixedIn = (s.engine as unknown as { fixedIn: Map<unknown, unknown> }).fixedIn;
    assert.equal(fixedIn.has(s.nodes.get('page')), true);
    s.engine.removeChild(s.nodes.get('app')!, s.nodes.get('page')!);
    s.engine.commit();
    assert.equal(fixedIn.has(s.nodes.get('page')), false);
    assert.equal(s.nodes.get('bar')!.fixedTo, undefined);
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
    return { engine, nodes, box, fabric };
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

  it('is placed against a view marked as the page of what is in it', () => {
    // A layer over the app that ends above the keyboard, say: what is fixed in it ends there.
    const css =
      '.layer { position: absolute; top: 40px; left: 0; right: 0; bottom: 300px }' +
      ' .c { position: fixed; left: 0; bottom: 20px; width: 50px; height: 30px }';
    assert.deepEqual(laidOut(css, ['layer', ['c']]).box('c'), [0, 750, 50, 30]);
    const marked = laidOut(css, ['layer', ['c']]);
    markPage(marked.nodes.get('layer')!);
    assert.deepEqual(marked.box('c'), [0, 450, 50, 30]);
    // And follows it as it is given another size: the keyboard going away.
    marked.engine.setProp(marked.nodes.get('layer')!, 'style', { bottom: 0 });
    assert.deepEqual(marked.box('c'), [0, 750, 50, 30]);
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

  it('stays on the screen when it goes back under a box that no longer clips', () => {
    // Under its page while the box it is written in clips, and back under that box once it no
    // longer does and the bar is styled again: placed against the screen either way.
    const css =
      `${OFF} .clip { overflow: hidden } .bar { position: fixed; top: 10px; left: 0; right: 0;` +
      ' height: 40px } .tall { height: 50px }';
    const s = laidOut(css, ['off', ['bar']]);
    s.engine.setClasses(s.nodes.get('off')!, 'off clip');
    // Committed at the root, or in the view a page's fixed boxes are committed in, which has no name.
    const atRoot = (all: readonly FakeFabricNode[]): boolean =>
      all.some((node) =>
        node.props['nativeID'] === undefined
          ? atRoot(node.children)
          : node.props['nativeID'] === 'bar',
      );
    const under = () => atRoot(s.fabric.committed);
    assert.deepEqual(s.box('bar'), [0, 10, 400, 40]);
    assert.equal(under(), true, 'under its page while the box clips');
    s.engine.setClasses(s.nodes.get('off')!, 'off');
    s.engine.setClasses(s.nodes.get('bar')!, 'bar tall');
    assert.deepEqual(s.box('bar'), [0, 10, 400, 50]);
    assert.equal(under(), false, 'back under the box it is written in');
  });

  it('goes back under its parent when only a box further up stops clipping, and out as it clips again', () => {
    // Nothing about the bar changes: the box that clipped lets go of its `overflow`, by a class
    // going away, by one going away from the box around it, and by a value set on it changing to
    // `visible` and then going away.
    const css =
      `${OFF} .clip, .shut > .off { overflow: hidden } .bar { position: fixed; top: 10px;` +
      ' left: 0; right: 0; height: 40px }';
    const ways: [
      string,
      (off: EngineNode, engine: Engine) => void,
      (off: EngineNode, engine: Engine) => void,
    ][] = [
      [
        'a class going away',
        (off, engine) => engine.setClasses(off, 'off clip'),
        (off, engine) => engine.setClasses(off, 'off'),
      ],
      [
        'a class going away from the box around it',
        (off, engine) => engine.setClasses(off.parent!, 'wrap shut'),
        (off, engine) => engine.setClasses(off.parent!, 'wrap'),
      ],
      [
        'a value set on it changing',
        (off, engine) => engine.setProp(off, 'style', { overflow: 'hidden' }),
        (off, engine) => engine.setProp(off, 'style', { overflow: 'visible' }),
      ],
      [
        'a value set on it going away',
        (off, engine) => engine.setProp(off, 'style', { overflow: 'hidden' }),
        (off, engine) => engine.setProp(off, 'style', null),
      ],
    ];
    for (const [way, clip, unclip] of ways) {
      const s = laidOut(css, ['wrap', ['off', ['mid', ['bar']]]]);
      const off = s.nodes.get('off')!;
      const find = (all: readonly FakeFabricNode[], name: string): FakeFabricNode | undefined =>
        all
          .map((node) => (node.props['nativeID'] === name ? node : find(node.children, name)))
          .find(Boolean);
      const underMid = () =>
        find(s.fabric.committed, 'mid')?.children.some((node) => node.props['nativeID'] === 'bar');
      clip(off, s.engine);
      assert.deepEqual(s.box('bar'), [0, 10, 400, 40], way);
      assert.equal(underMid(), false, `under its page while the box clips, by ${way}`);
      unclip(off, s.engine);
      assert.deepEqual(s.box('bar'), [0, 10, 400, 40], way);
      assert.equal(underMid(), true, `back under its parent, by ${way}`);
      // Only once: under its parent, and not in the page's layer as well.
      const count = (all: readonly FakeFabricNode[]): number =>
        all.reduce(
          (sum, node) => sum + Number(node.props['nativeID'] === 'bar') + count(node.children),
          0,
        );
      assert.equal(count(s.fabric.committed), 1, way);
      // And under its page again once the box clips again, after a commit with it clean, and
      // back once more as it lets go.
      clip(off, s.engine);
      assert.deepEqual(s.box('bar'), [0, 10, 400, 40], way);
      assert.equal(underMid(), false, `under its page as the box clips again, by ${way}`);
      assert.equal(count(s.fabric.committed), 1, way);
      unclip(off, s.engine);
      assert.deepEqual(s.box('bar'), [0, 10, 400, 40], way);
      assert.equal(underMid(), true, `back under its parent again, by ${way}`);
    }
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
    // As wide as its content too, which a fixed box is not left as: see the end of this file.
    const s = scene(`${CHIP} .loose { position: absolute; left: 0; top: 0 }`, [
      'chip',
      ['action', ['loose'], ['label']],
    ]);
    assert.deepEqual(s.tree(), [['chip', ['action', ['loose'], ['label']]]]);
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

  it('follows a value set on its parent starting to clip, stopping and starting again', () => {
    // Nothing about the ring changes, and a value set on the action restyles only the action.
    const s = chip('action');
    s.tree();
    const action = s.nodes.get('action')!;
    s.engine.setProp(action, 'style', { overflow: 'hidden' });
    assert.deepEqual(s.tree(), [['chip', ['action', ['label']], ['trail'], ['ring']]]);
    s.engine.setProp(action, 'style', null);
    assert.deepEqual(s.tree(), [['chip', ['action', ['ring'], ['label']], ['trail']]]);
    s.engine.setProp(action, 'style', { overflow: 'hidden' });
    assert.deepEqual(s.tree(), [['chip', ['action', ['label']], ['trail'], ['ring']]]);
  });

  it('keeps the static position its clipping parent gives it, on an axis it has no inset on', () => {
    // Chrome's [x, y] from the chip: inside the chip's padding, the action's margin and the
    // action's padding on the free axis, and at the chip's padding edge on the other.
    const css =
      '.chip { position: relative; flex-direction: row; padding: 7px 0 0 10px; margin-top: 20px }' +
      ' .action { position: static; overflow: hidden; margin-left: 30px; padding: 3px 0 0 5px;' +
      ' width: 100px; height: 50px } .ring { position: absolute; top: 0; width: 10px; height: 10px }' +
      ' .down { position: absolute; left: 0; width: 10px; height: 10px }';
    for (const [name, place] of [
      ['ring', [45, 0]],
      ['down', [0, 10]],
    ] as const) {
      const fabric = createLaidOutFabric();
      const engine = new Engine(fabric, 1, {
        globalStyles: compileCss(css, 'app.css') as never,
        conditions: { width: 400, height: 800, colorScheme: 'light' },
      });
      const element = (classes: string, parent: EngineNode) => {
        const node = engine.createElement('view');
        engine.setClasses(node, classes);
        engine.setProp(node, 'nativeID', classes);
        engine.appendChild(parent, node);
        return node;
      };
      element(name, element('action', element('chip', engine.root)));
      engine.commit();
      const [at, chipAt] = [fabric.box(name), fabric.box('chip')];
      assert.deepEqual([at.left - chipAt.left, at.top - chipAt.top], place, name);
      // Under the chip, which it is placed against, and not the action, which clips.
      const chip = fabric.committed.find((node) => node.props['nativeID'] === 'chip')!;
      const action = chip.children.find((node) => node.props['nativeID'] === 'action')!;
      assert.equal(action.children.length, 0, name);
    }
  });

  it('goes with its parent when the parent is taken away', () => {
    const s = chip();
    s.tree();
    s.engine.removeChild(s.nodes.get('chip')!, s.nodes.get('action')!);
    assert.deepEqual(s.tree(), [['chip', ['trail']]]);
  });
});

describe('a fixed box as wide as its content, in a narrower box', () => {
  // Chrome's values, with the layout reset, at ten points a character in a 400 point screen.
  const SHORT = 'abcdefg abcdefg abcdefg';
  const LONG = `${SHORT} ${SHORT}`;
  const NARROW = '.narrow { width: 100px; height: 300px; margin-top: 30px; margin-left: 20px }';

  function laidOut(css: string, text: string) {
    const fabric = createLaidOutFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(`${NARROW} ${css}`, 'app.css') as never,
      conditions: { width: 400, height: 800, colorScheme: 'light' },
    });
    const element = (name: string, parent: EngineNode) => {
      const node = engine.createElement('view');
      engine.setClasses(node, name);
      engine.setProp(node, 'nativeID', name);
      engine.appendChild(parent, node);
      return node;
    };
    const fixed = element('box', element('narrow', engine.root));
    const words = engine.createElement('text');
    engine.appendChild(words, engine.createText(text));
    engine.appendChild(fixed, words);
    const box = () => {
      engine.commit();
      const { left, width, height } = fabric.box('box');
      return [left, width, height];
    };
    /** Whether the box is committed under the box it is written in. */
    const underItsParent = () => {
      engine.commit();
      const narrow = fabric.committed.find((node) => node.props['nativeID'] === 'narrow');
      return narrow?.children.some((node) => node.props['nativeID'] === 'box') ?? false;
    };
    /** Where the box is in the screen. */
    const at = () => {
      engine.commit();
      const { left, top } = fabric.box('box');
      return [left, top];
    };
    return { engine, fixed, box, at, underItsParent };
  }

  /** Run `check` on iOS and on Android, which commits every fixed box under its page. */
  const onBoth = (check: () => void) => {
    try {
      for (const platform of ['ios', 'android']) {
        registerPlatformComponents(platform);
        check();
      }
    } finally {
      registerPlatformComponents('ios');
    }
  };

  it('keeps its static position on an axis it has no inset on, where Chrome has it', () =>
    onBoth(() => {
      // Chrome's [x, y], the box written in a 100 point box at 20 across and 30 down, and its
      // height: wrapped in the room right of where it starts. Under its page all the same.
      for (const [style, inset, place] of [
        ['left: 0', { left: 0 }, [0, 30, 40]],
        ['left: 0; width: auto', { left: 0, width: 'auto' }, [0, 30, 40]],
        ['left: 0; top: auto', { left: 0, top: 'auto' }, [0, 30, 40]],
        ['top: 0', { top: 0 }, [20, 0, 40]],
        ['', {}, [20, 30, 40]],
        ['left: auto; top: auto', { left: 'auto', top: 'auto' }, [20, 30, 40]],
        // React Native's names for a logical inset, on the element.
        ['inset-inline-start: 0', { insetInlineStart: 0 }, [0, 30, 40]],
        ['inset-block-start: 0', { insetBlockStart: 0 }, [20, 0, 40]],
      ] as const) {
        const fromSheet = laidOut(`.box { position: fixed; ${style} }`, LONG);
        const element = laidOut('', LONG);
        element.engine.setProp(element.fixed, 'style', { position: 'fixed', ...inset });
        for (const [way, s] of [
          ['a sheet', fromSheet],
          ['a value set on the element', element],
        ] as const) {
          const name = `${style || 'no insets'}, by ${way}`;
          assert.deepEqual([...s.at(), s.box()[2]], place, name);
          assert.equal(s.underItsParent(), false, name);
        }
      }
    }));

  it('keeps the static position its parent gives it: padding, alignment and direction', () =>
    onBoth(() => {
      // Chrome's [x, y] for a box three characters wide, in the same 100 by 300 point box.
      const PAD = { paddingTop: 10, paddingBottom: 10, paddingLeft: 15, paddingRight: 15 };
      const CENTRED = { alignItems: 'center', justifyContent: 'center' } as const;
      const END = { alignItems: 'flex-end', justifyContent: 'flex-end' } as const;
      const ROW = { flexDirection: 'row', ...CENTRED } as const;
      const RTL = { direction: 'rtl' } as const;
      for (const [parentCss, parentStyle, boxCss, place] of [
        ['padding: 10px 15px', PAD, '', [35, 40]],
        ['padding: 10px 15px', PAD, 'left: 0', [0, 40]],
        ['padding: 10px 15px', PAD, 'top: 0', [35, 0]],
        ['align-items: center; justify-content: center', CENTRED, '', [55, 170]],
        ['align-items: center; justify-content: center', CENTRED, 'left: 0', [0, 170]],
        ['align-items: center; justify-content: center', CENTRED, 'top: 0', [55, 0]],
        ['align-items: flex-end; justify-content: flex-end', END, '', [90, 310]],
        ['flex-direction: row; align-items: center; justify-content: center', ROW, '', [55, 170]],
        ['direction: rtl', RTL, '', [90, 30]],
        ['direction: rtl', RTL, 'top: 0', [90, 0]],
        ['direction: rtl', RTL, 'left: 0', [0, 30]],
        ['direction: rtl; padding: 10px 15px', { ...RTL, ...PAD }, '', [75, 40]],
        [
          'direction: rtl; padding: 10px 15px; border-width: 2px',
          { ...RTL, ...PAD, borderWidth: 2 },
          '',
          [73, 42],
        ],
        ['direction: rtl; align-items: flex-end', { ...RTL, alignItems: 'flex-end' }, '', [20, 30]],
        ['direction: rtl; flex-direction: row', { ...RTL, flexDirection: 'row' }, '', [90, 30]],
        [
          'direction: rtl; flex-direction: row-reverse',
          { ...RTL, flexDirection: 'row-reverse' },
          '',
          [20, 30],
        ],
        ['flex-direction: row-reverse', { flexDirection: 'row-reverse' }, '', [90, 30]],
        ['flex-direction: column-reverse', { flexDirection: 'column-reverse' }, '', [20, 310]],
        [
          'flex-direction: row; justify-content: flex-end',
          { flexDirection: 'row', justifyContent: 'flex-end' },
          '',
          [90, 30],
        ],
        ['justify-content: space-between', { justifyContent: 'space-between' }, '', [20, 30]],
        ['justify-content: space-around', { justifyContent: 'space-around' }, '', [20, 170]],
        ['', {}, 'align-self: center', [55, 30]],
        ['align-items: center', { alignItems: 'center' }, 'margin-left: 10px', [60, 30]],
        ['padding: 10px 15px; border-width: 2px', { ...PAD, borderWidth: 2 }, '', [37, 42]],
        // A block does not align its children by either.
        [
          'display: block; align-items: center; justify-content: center',
          { display: 'block', ...CENTRED },
          '',
          [20, 30],
        ],
        ['display: block; direction: rtl', { display: 'block', ...RTL }, '', [90, 30]],
      ] as const) {
        const box = `.box { position: fixed; ${boxCss} }`;
        const fromSheet = laidOut(`.narrow { ${parentCss} } ${box}`, 'abc');
        const element = laidOut(box, 'abc');
        element.engine.setProp(element.fixed.parent!, 'style', parentStyle);
        for (const [way, s] of [
          ['a sheet', fromSheet],
          ['a value set on the parent', element],
        ] as const) {
          const name = `${parentCss}, ${boxCss || 'no insets'}, by ${way}`;
          assert.deepEqual(s.at(), place, name);
          assert.equal(s.underItsParent(), false, name);
        }
      }
    }));

  it('takes the direction its parent inherits, and the padding at that start', () =>
    onBoth(() => {
      // Chrome's: right to left from a box around the parent, which puts the parent at its right,
      // with 15 points at the parent's start.
      for (const [way, sheet, set] of [
        ['a sheet', '.around { direction: rtl } .narrow { padding-inline-start: 15px }', null],
        ['a value set on each', '', { direction: 'rtl' }],
      ] as const) {
        const s = laidOut(`${sheet} .box { position: fixed }`, 'abc');
        const narrow = s.fixed.parent!;
        const around = s.engine.createElement('view');
        s.engine.setClasses(around, 'around');
        s.engine.removeChild(s.engine.root, narrow);
        s.engine.appendChild(s.engine.root, around);
        s.engine.appendChild(around, narrow);
        if (set) {
          s.engine.setProp(around, 'style', set);
          s.engine.setProp(narrow, 'style', { paddingStart: 15 });
        }
        assert.deepEqual(s.at(), [355, 30], way);
      }
    }));

  it('stays where it is as a scroll view it is in scrolls, which moves what native reads', () => {
    // Native reads a box in a scroll view where it has scrolled to, and a browser keeps a fixed
    // box where it was laid out: left at its page's start, it does not follow the scrolling.
    const fabric = createLaidOutFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(
        '.content { padding-top: 50px } .box { position: fixed; left: 0 }',
        'app.css',
      ) as never,
      conditions: { width: 400, height: 800, colorScheme: 'light' },
    });
    const scroll = engine.createElement('scroll-view');
    const content = engine.createElement('view');
    engine.setClasses(content, 'content');
    const box = engine.createElement('view');
    engine.setClasses(box, 'box');
    engine.setProp(box, 'nativeID', 'box');
    engine.appendChild(engine.root, scroll);
    engine.appendChild(scroll, content);
    engine.appendChild(content, box);
    const at = () => {
      engine.commit();
      return fabric.box('box').top;
    };
    const first = at();
    const read = fabric.getBoundingClientRect!.bind(fabric);
    // Scrolled down 100 points: every box read back is that much higher.
    fabric.getBoundingClientRect = (handle, transform) => {
      const rect = read(handle, transform);
      return rect && [rect[0], rect[1] - 100, rect[2], rect[3]];
    };
    engine.setProp(box, 'style', { opacity: 0.5 });
    assert.equal(at(), first);
  });

  it('is centred no wider than twice the room on the nearer side of its centre', () =>
    onBoth(() => {
      // Chrome's x for 23 characters centred in the 100 point box: 140 wide at 0, where Chrome
      // wraps the text in those 140 and a native box is as wide as the text.
      const centred = '.narrow { align-items: center; justify-content: center }';
      const s = laidOut(`${centred} .box { position: fixed }`, SHORT);
      assert.equal(s.at()[0], 0);
    }));

  it('follows its static position as its parent moves', () => {
    const css = '.box { position: fixed; left: 0 } .lower { margin-top: 60px }';
    const s = laidOut(css, 'abc');
    assert.deepEqual([s.underItsParent(), s.at()], [false, [0, 30]]);
    // Moved down by a box before it, which grows and goes.
    const above = s.engine.createElement('view');
    s.engine.setProp(above, 'style', { height: 25 });
    s.engine.insertBefore(s.engine.root, above, s.fixed.parent!);
    assert.deepEqual(s.at(), [0, 55]);
    s.engine.setProp(above, 'style', { height: 45 });
    assert.deepEqual(s.at(), [0, 75]);
    s.engine.removeChild(s.engine.root, above);
    assert.deepEqual(s.at(), [0, 30]);
    s.engine.setClasses(s.fixed.parent!, 'narrow lower');
    assert.deepEqual(s.at(), [0, 60]);
    s.engine.setClasses(s.fixed.parent!, 'narrow');
    assert.deepEqual(s.at(), [0, 30]);
    // The same set on the parent, across and down, and re-centred in a parent that grows.
    s.engine.setProp(s.fixed.parent!, 'style', { marginTop: 90, marginLeft: 50 });
    assert.deepEqual(s.at(), [0, 90]);
    s.engine.setProp(s.fixed, 'style', { left: 'auto' });
    assert.deepEqual(s.at(), [50, 90]);
    s.engine.setProp(s.fixed.parent!, 'style', { alignItems: 'center', width: 200 });
    assert.deepEqual(s.at(), [105, 30]);
    s.engine.setProp(s.fixed.parent!, 'style', null);
    assert.deepEqual(s.at(), [20, 30]);
  });

  it('follows an inset coming and going on an axis', () => {
    const css = '.box { position: fixed; left: 0 } .up { top: 5px }';
    const s = laidOut(css, 'abc');
    assert.deepEqual(s.at(), [0, 30]);
    s.engine.setClasses(s.fixed, 'box up');
    assert.deepEqual(s.at(), [0, 5]);
    s.engine.setClasses(s.fixed, 'box');
    assert.deepEqual(s.at(), [0, 30]);
    // The same set on the element, on each axis.
    s.engine.setProp(s.fixed, 'style', { top: 5 });
    assert.deepEqual(s.at(), [0, 5]);
    s.engine.setProp(s.fixed, 'style', { left: 'auto', top: 5 });
    assert.deepEqual(s.at(), [20, 5]);
    s.engine.setProp(s.fixed, 'style', { left: 'auto', right: 7, top: 5 });
    assert.deepEqual(s.at(), [400 - 7 - 30, 5]);
    s.engine.setProp(s.fixed, 'style', null);
    assert.deepEqual(s.at(), [0, 30]);
    assert.equal(s.underItsParent(), false);
  });

  it('reads an inset set on the element over the other form of it in a sheet', () => {
    // Chrome: an inline `inset-inline-start: auto` is the `left` a sheet sets, left to right, so
    // the box is at its static position across; and the other way round. React Native's `start`
    // is read before `left`, so a `start: auto` left committed would hold the box at the start.
    for (const [sheet, inline, place] of [
      ['left: 0', { start: 'auto' }, [20, 30]],
      ['', { start: 'auto' }, [20, 30]],
      ['inset-inline-start: 0', { left: 'auto' }, [20, 30]],
      ['left: auto', { start: 0 }, [0, 30]],
    ] as const) {
      const s = laidOut(`.box { position: fixed; ${sheet} }`, 'abc');
      s.engine.setProp(s.fixed, 'style', inline);
      assert.deepEqual(s.at(), place, `${sheet} under ${JSON.stringify(inline)}`);
    }
  });

  it('keeps its static position as a width of its own comes and goes', () => {
    const css = '.box { position: fixed; left: 0 } .sized { width: 300px }';
    const s = laidOut(css, LONG);
    assert.deepEqual([s.underItsParent(), s.at()], [false, [0, 30]]);
    s.engine.setClasses(s.fixed, 'box sized');
    assert.deepEqual([s.underItsParent(), s.at()], [true, [0, 30]]);
    s.engine.setClasses(s.fixed, 'box');
    assert.deepEqual([s.underItsParent(), s.at()], [false, [0, 30]]);
    s.engine.setProp(s.fixed, 'style', { width: 300, left: 'auto' });
    assert.deepEqual([s.underItsParent(), s.at()], [true, [20, 30]]);
    s.engine.setProp(s.fixed, 'style', { left: 'auto' });
    assert.deepEqual([s.underItsParent(), s.at()], [false, [20, 30]]);
  });

  it('wraps in the screen, and not in the box it is written in', () => {
    const at = '.box { position: fixed; top: 0; left: 0 }';
    assert.deepEqual(laidOut(at, SHORT).box(), [0, 230, 20]);
    // Two lines, where the box it is written in would make six. Chrome has the box 400 wide,
    // where a native paragraph is as wide as its longest line.
    assert.deepEqual(laidOut(at, LONG).box(), [0, 390, 40]);
    const fits = '.box { position: fixed; top: 0; width: fit-content; left: 10px; right: 20px }';
    assert.deepEqual(laidOut(fits, SHORT).box(), [10, 230, 20]);
  });

  it('counts a width of auto as no width of its own', () => {
    const s = laidOut('.box { position: fixed; top: 0; left: 0; width: auto }', LONG);
    assert.deepEqual([s.underItsParent(), s.box()], [false, [0, 390, 40]]);
    // The same set on the element, over a width in points.
    const sized = laidOut('.box { position: fixed; top: 0; left: 0; width: 300px }', LONG);
    sized.engine.setProp(sized.fixed, 'style', { width: 'auto' });
    assert.deepEqual([sized.underItsParent(), sized.box()], [false, [0, 390, 40]]);
    // Stretched between two insets, it is as wide as they make it, and stays.
    const stretched = laidOut(
      '.box { position: fixed; top: 0; left: 0; right: 0; width: auto }',
      LONG,
    );
    assert.deepEqual([stretched.underItsParent(), stretched.box()], [true, [0, 400, 40]]);
  });

  it('stays under its parent with a width of its own, or stretched between two insets', () => {
    for (const [css, box] of [
      ['.box { position: fixed; top: 0; left: 0; width: 300px }', [0, 300, 40]],
      ['.box { position: fixed; top: 0; left: 0; right: 0 }', [0, 400, 40]],
    ] as const) {
      const s = laidOut(css, LONG);
      assert.deepEqual(s.box(), box, css);
      assert.equal(s.underItsParent(), true, css);
    }
  });

  it('follows a width of its own coming and going', () => {
    const css = '.box { position: fixed; top: 0; left: 0 } .sized { width: 300px }';
    const s = laidOut(css, LONG);
    assert.deepEqual([s.underItsParent(), s.box()], [false, [0, 390, 40]]);
    s.engine.setClasses(s.fixed, 'box sized');
    assert.deepEqual([s.underItsParent(), s.box()], [true, [0, 300, 40]]);
    s.engine.setClasses(s.fixed, 'box');
    assert.deepEqual([s.underItsParent(), s.box()], [false, [0, 390, 40]]);
    // The same set on the element.
    s.engine.setProp(s.fixed, 'style', { width: 300 });
    assert.deepEqual([s.underItsParent(), s.box()], [true, [0, 300, 40]]);
    s.engine.setProp(s.fixed, 'style', null);
    assert.deepEqual([s.underItsParent(), s.box()], [false, [0, 390, 40]]);
  });

  it('waits for a finger on it to lift before it goes back under its parent', () => {
    const css = '.box { position: fixed; top: 0; left: 0 } .sized { width: 300px }';
    const s = laidOut(css, LONG);
    assert.equal(s.underItsParent(), false);
    const point = { identifier: 0, pageX: 10, pageY: 10 };
    s.engine.dispatchEvent(s.fixed, 'topTouchStart', { ...point, touches: [point] });
    s.engine.setClasses(s.fixed, 'box sized');
    assert.deepEqual([s.underItsParent(), s.box()], [false, [0, 300, 40]]);
    s.engine.dispatchEvent(s.fixed, 'topTouchEnd', { ...point, touches: [] });
    assert.deepEqual([s.underItsParent(), s.box()], [true, [0, 300, 40]]);
  });

  it('settles in the commit it appears in, with no pass left over', () => {
    // At its static position on an axis too, centred by its own size, and wider than the room
    // its centre leaves it.
    const centred = '.narrow { align-items: center; justify-content: center }';
    for (const [css, text] of [
      ['.box { position: fixed; top: 0; left: 0 }', SHORT],
      ['.box { position: fixed; left: 0 }', SHORT],
      ['.box { position: fixed }', LONG],
      [`${centred} .box { position: fixed }`, 'abc'],
      [`${centred} .box { position: fixed }`, LONG],
    ] as const) {
      const s = laidOut(css, text);
      assert.equal(s.engine.commit(), true, css);
      assert.equal(s.engine.commit(), false, css);
    }
  });

  it('leaves the row it is in to share its room out by the padding the row has now', () => {
    // Chrome: in a 300 point row with 60 of padding, two items no narrower than 120 share a line
    // and the third takes one of its own, whether the padding was there first or came later.
    const css =
      '.row { flex-direction: row; flex-wrap: wrap; width: 300px } .w { width: 120px; height: 10px }' +
      ' .it { flex: 1 1 0%; min-width: auto; height: 20px } .f { position: fixed; height: 5px }';
    const fabric = createLaidOutFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(css, 'app.css') as never,
      conditions: { width: 400, height: 800, colorScheme: 'light' },
    });
    const element = (name: string, parent: EngineNode) => {
      const node = engine.createElement('view');
      engine.setClasses(node, name);
      engine.setProp(node, 'nativeID', name);
      engine.appendChild(parent, node);
      return node;
    };
    const row = element('row', engine.root);
    for (const name of ['it a', 'it b', 'it c']) element('w', element(name, row));
    const words = engine.createElement('text');
    engine.appendChild(words, engine.createText('abc'));
    engine.appendChild(element('f', row), words);
    engine.commit();
    engine.setProp(row, 'style', { paddingLeft: 60 });
    engine.commit();
    const at = (name: string) => {
      const { left, top, width } = fabric.box(name);
      return [left, top, width];
    };
    assert.deepEqual(['it a', 'it b', 'it c'].map(at), [
      [60, 0, 120],
      [180, 0, 120],
      [60, 20, 240],
    ]);
    // And the fixed box at its static position, inside the padding.
    assert.deepEqual(at('f'), [60, 0, 30]);
  });
});
