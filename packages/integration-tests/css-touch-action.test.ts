/**
 * `touch-action`: what a browser may do with a touch on an element, and so what the element
 * keeps for itself. `pan-y` on a slider says a drag across it is the slider's. From iOS 26 the
 * swipe back starts anywhere on a screen and takes a drag to the right from whatever was
 * following the finger, so a touch on such an element holds the screen's swipe off while it lasts.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, registerViewName, scrollsOverflow, type EngineNode } from '@ng-native/fabric';
import { compileCss, createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

registerViewName('rns-screen', 'RNSScreen');

const CSS =
  '.slider { touch-action: pan-y } .map { touch-action: none } .row { touch-action: pan-x }' +
  ' .plain { touch-action: manipulation } .both { touch-action: pan-x pan-y }' +
  ' .scroller { overflow: auto }';

/** A screen with a page that scrolls: a scroll view, or an element that scrolls its overflow. */
function scene(kind: 'scroll-view' | 'overflow' = 'scroll-view') {
  const reports: string[] = [];
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(CSS, 'app.css', {
      onUnsupported: (m: string) => reports.push(m),
    }) as never,
  });
  const add = (name: string, classes: string, parent: EngineNode) => {
    const node = engine.createElement(name);
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', classes || name);
    engine.appendChild(parent, node);
    return node;
  };
  const screen = add('rns-screen', '', engine.root);
  const page = add(kind === 'scroll-view' ? 'scroll-view' : 'view', 'page', screen);
  if (kind === 'overflow') {
    scrollsOverflow(page);
    engine.setClasses(page, 'page scroller');
  }
  const nodes: Record<string, EngineNode> = { screen, page };
  for (const name of ['slider', 'map', 'row', 'plain', 'both', 'button']) {
    nodes[name] = add('view', name, page);
  }
  nodes['thumb'] = add('view', 'thumb', nodes['slider']!);
  engine.commit();
  const props = (id: string): Record<string, unknown> => {
    engine.commit();
    const find = (all: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const each of all) {
        const found = each.props['nativeID'] === id ? each : find(each.children);
        if (found) return found;
      }
      return undefined;
    };
    return find(fabric.committed)!.props;
  };
  /** What native was told of who holds the touch: `[holds, and native's own gesture is held off]`. */
  const told: [boolean, boolean][] = [];
  (fabric as unknown as { setIsJSResponder: unknown }).setIsJSResponder = (
    _: unknown,
    holds: boolean,
    block: boolean,
  ) => void told.push([holds, block]);
  for (const name of ['slider', 'map', 'button']) {
    engine.setResponder(nodes[name]!, { onStartShouldSetResponder: () => true });
  }
  /** A finger down on a node at a point, moved to one, or lifted. */
  const finger = (name: string, phase: 'Start' | 'Move' | 'End', pageX = 0, pageY = 0) =>
    engine.dispatchEvent(nodes[name]!, `topTouch${phase}`, {
      pageX,
      pageY,
      touches: phase === 'End' ? [] : [{ pageX, pageY }],
    });
  const touch = (name: string, phase: 'Start' | 'End' | 'Cancel') =>
    engine.dispatchEvent(nodes[name]!, `topTouch${phase}`, {
      touches: phase === 'Start' ? [{}] : [],
    });
  /** Whether the screen's swipe back can start: from anywhere, or from nowhere while held. */
  const swipe = () => {
    const distance = props('rns-screen')['gestureResponseDistance'] as { end?: number } | null;
    return distance?.end !== 0;
  };
  return { engine, nodes, props, touch, swipe, reports, finger, told };
}

describe('touch-action', () => {
  it('is read, and nothing of it reaches a view', () => {
    const s = scene();
    assert.deepEqual(s.reports, []);
    assert.equal('touchAction' in s.props('slider'), false);
  });

  it('holds the swipe back off while a finger is on what keeps a sideways drag', () => {
    const s = scene();
    assert.equal(s.swipe(), true);
    s.touch('slider', 'Start');
    assert.equal(s.swipe(), false, 'pan-y: across is its own');
    s.touch('slider', 'End');
    assert.equal(s.swipe(), true, 'back once the finger lifts');
    s.touch('map', 'Start');
    assert.equal(s.swipe(), false, 'none: every drag is its own');
    s.touch('map', 'Cancel');
    assert.equal(s.swipe(), true);
  });

  it('holds it off for a touch on anything inside such an element', () => {
    const s = scene();
    s.touch('thumb', 'Start');
    assert.equal(s.swipe(), false);
    s.touch('thumb', 'End');
    assert.equal(s.swipe(), true);
  });

  it("leaves it on where a drag to the side is the browser's to take, or nothing is said", () => {
    const s = scene();
    for (const name of ['row', 'plain', 'both', 'button']) {
      s.touch(name, 'Start');
      assert.equal(s.swipe(), true, name);
      s.touch(name, 'End');
    }
  });

  it('lets go of a touch that never ended, when the next one starts', () => {
    const s = scene();
    s.touch('slider', 'Start');
    assert.equal(s.swipe(), false);
    // No end came: the element went while the finger was down, or native sent none.
    s.touch('button', 'Start');
    assert.equal(s.swipe(), true, 'a first finger down is a new touch');
    s.touch('button', 'End');
    s.touch('map', 'Start');
    assert.equal(s.swipe(), false, 'and the next is held as any other');
  });

  it('refuses a keyword that stands alone when it is written beside another', () => {
    for (const value of ['none pan-x', 'pan-y auto', 'manipulation pan-y']) {
      const reports: string[] = [];
      const sheet = compileCss(`.a { touch-action: ${value} }`, 'app.css', {
        onUnsupported: (m: string) => reports.push(m),
      });
      assert.equal(reports.length, 1, value);
      assert.match(reports[0]!, /touch-action/);
      assert.equal(JSON.stringify(sheet).includes('touchAction'), false, value);
    }
  });

  it('leaves a screen whose swipe is off as it is, before and after', () => {
    const s = scene();
    // And one given a distance of its own has it back as it was.
    const own = { start: -1, end: 40, top: -1, bottom: -1 };
    s.engine.setProp(s.nodes['screen']!, 'gestureEnabled', false);
    s.engine.setProp(s.nodes['screen']!, 'gestureResponseDistance', own);
    s.touch('slider', 'Start');
    assert.equal(s.swipe(), false);
    s.touch('slider', 'End');
    assert.equal(s.props('rns-screen')['gestureEnabled'], false);
    assert.deepEqual(s.props('rns-screen')['gestureResponseDistance'], own);
  });

  it('keeps a drag that set off sideways from a scroll view under it, and leaves one that set off down', () => {
    // A slider in a page that scrolls: `pan-y` leaves a drag down the page to the page. Once the
    // finger has set off across, the drag is the slider's however it wanders after, as a
    // browser settles which it is from the way a touch first moves.
    const s = scene();
    const blocked = () => s.told.some(([holds, block]) => holds && block);
    /** Whether the page under the slider may scroll: iOS holds a scroll view off no other way. */
    const scrolls = () => s.props('page')['scrollEnabled'] !== false;
    s.finger('slider', 'Start', 100, 100);
    assert.equal(blocked(), false, 'not before it has moved');
    s.finger('slider', 'Move', 101, 108);
    assert.equal(blocked(), false, 'set off down the page: the page may scroll');
    s.finger('slider', 'Move', 140, 110);
    assert.equal(blocked(), false, 'and it stays with the page for that touch');
    assert.equal(scrolls(), true);
    s.finger('slider', 'End', 140, 110);

    s.told.length = 0;
    s.finger('slider', 'Start', 100, 100);
    s.finger('slider', 'Move', 108, 101);
    assert.equal(blocked(), true, 'set off across: native scrolling is held off');
    assert.equal(scrolls(), false, 'and the page it is in does not scroll');
    s.finger('slider', 'End', 108, 101);
    assert.deepEqual(s.told.at(-1), [false, false], 'and given back with the touch');
    assert.equal(scrolls(), true);
  });

  it('keeps a drag that set off sideways from an element under it that scrolls its overflow', () => {
    // The page is a scroll view only by its CSS: the same drag holds that one off.
    const s = scene('overflow');
    const scrolls = () => s.props('page')['scrollEnabled'] !== false;
    s.finger('slider', 'Start', 100, 100);
    s.finger('slider', 'Move', 101, 108);
    assert.equal(scrolls(), true, 'set off down the page: the page may scroll');
    s.finger('slider', 'End', 101, 108);

    s.finger('slider', 'Start', 100, 100);
    s.finger('slider', 'Move', 108, 101);
    assert.equal(scrolls(), false, 'set off across: the page it is in does not scroll');
    s.finger('slider', 'End', 108, 101);
    assert.equal(scrolls(), true, 'given back with the touch');
  });

  it('keeps every drag from a scroll view where the element takes them all', () => {
    const s = scene();
    s.finger('map', 'Start', 100, 100);
    assert.deepEqual(s.told.at(-1), [true, true], 'none: from the moment it is touched');
    assert.equal(s.props('page')['scrollEnabled'], false);
    s.finger('map', 'End', 100, 100);
    s.told.length = 0;
    s.finger('button', 'Start', 100, 100);
    s.finger('button', 'Move', 130, 100);
    assert.equal(
      s.told.some(([holds, block]) => holds && block),
      false,
      'nothing said: as before',
    );
  });
});

describe('a drag a package keeps from the page', () => {
  // What `@ng-native/web-compat` asks for a `touchmove` a listener prevented the default of: the
  // button says nothing of `touch-action`, so only the ask keeps its drag.
  const kept = () => {
    const s = scene();
    const scrolls = () => s.props('page')['scrollEnabled'] !== false;
    /** A move on the button, with this many fingers down. */
    const fingers = (phase: 'Start' | 'Move' | 'End' | 'Cancel', down: number) =>
      s.engine.dispatchEvent(s.nodes['button']!, `topTouch${phase}`, {
        pageX: 100,
        pageY: 100,
        touches: Array.from({ length: down }, () => ({ pageX: 100, pageY: 100 })),
      });
    const keep = () => s.engine.keepDrag(s.nodes['button']!);
    return { ...s, scrolls, fingers, keep };
  };

  it('holds native off the touch and the page still, until the last finger lifts', () => {
    const s = kept();
    s.fingers('Start', 1);
    s.fingers('Move', 1);
    assert.deepEqual(s.told.at(-1), [true, false], 'nothing asked yet');
    s.keep();
    assert.deepEqual(s.told.at(-1), [true, true], 'whoever holds the touch keeps it');
    assert.equal(s.scrolls(), false);
    s.fingers('End', 0);
    assert.equal(s.scrolls(), true, 'given back with the touch');
  });

  it('leaves the next drag, that no listener keeps, to the page', () => {
    const s = kept();
    s.fingers('Start', 1);
    s.keep();
    s.fingers('End', 0);
    s.told.length = 0;
    s.fingers('Start', 1);
    s.fingers('Move', 1);
    assert.deepEqual(s.told, [[true, false]]);
    assert.equal(s.scrolls(), true);
    s.keep();
    assert.equal(s.scrolls(), false, 'and keeps it when it is asked again');
  });

  it('lets go of a kept drag whose end never came, when the next touch starts', () => {
    const s = kept();
    s.fingers('Start', 1);
    s.keep();
    s.fingers('Start', 1);
    assert.equal(s.scrolls(), true);
  });

  it('keeps it while a second finger is down after the first lifts', () => {
    const s = kept();
    s.fingers('Start', 1);
    s.keep();
    s.fingers('Start', 2);
    s.fingers('End', 1);
    assert.equal(s.scrolls(), false, 'a finger is still on');
    s.fingers('End', 0);
    assert.equal(s.scrolls(), true);
  });

  it('gives it back for a touch native cancelled', () => {
    const s = kept();
    s.fingers('Start', 1);
    s.keep();
    s.fingers('Cancel', 0);
    assert.equal(s.scrolls(), true);
    s.fingers('Start', 1);
    assert.deepEqual(s.told.at(-1), [true, false]);
  });
});
