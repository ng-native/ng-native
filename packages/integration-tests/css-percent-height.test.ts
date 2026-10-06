/**
 * A percentage height where the parent has no height of its own to take a percentage of.
 *
 * CSS resolves `height: 100%` against the parent's height when that is definite: written, or
 * given by the layout around it (a box that grows in a column, or stretches across a row). A
 * parent as tall as its content has none, and the percentage is `auto`. Yoga resolves it against
 * the space on offer instead, which is the height of the screen, or of everything a scroll view
 * holds. So the engine sends no height where CSS has none to give.
 *
 * Measured in Chrome with the web host's reset, a 20px child in each case: 100% under a
 * content-sized parent is 20, where Yoga makes it the 800 of the screen. A percentage below 100
 * is that share of the content's height in Chrome and the content's height here.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

/** `.g` holding `.p` holding `.c`, under `css`, with the child's committed props. */
function scene(css: string, classes: { g?: string; p?: string; c?: string } = {}) {
  const sheet = compileCss(css, 'app.css');
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  const make = (name: string, parent: EngineNode): EngineNode => {
    const node = engine.createElement('view');
    engine.setClasses(node, name);
    engine.appendChild(parent, node);
    return node;
  };
  const grand = make(classes.g ?? 'g', engine.root);
  const parent = make(classes.p ?? 'p', grand);
  const child = make(classes.c ?? 'c', parent);
  const committed = () => {
    engine.commit();
    return fabric.committed[0]!.children[0]!;
  };
  return {
    engine,
    grand,
    parent,
    child,
    parentProps: (): Record<string, unknown> => committed().props,
    props: (): Record<string, unknown> => committed().children[0]!.props,
  };
}

const FULL = '.c { height: 100% }';

describe('a percentage height', () => {
  it('is no height under a parent as tall as its content', () => {
    assert.equal('height' in scene(FULL).props(), false);
  });

  it('is kept under a parent with a height', () => {
    assert.equal(scene(`.p { height: 200px } ${FULL}`).props()['height'], '100%');
  });

  it('is kept under a parent that grows in a column with a height', () => {
    const css = `.g { height: 400px } .p { flex: 1 } ${FULL}`;
    assert.equal(scene(css).props()['height'], '100%');
  });

  it('is no height under a parent that would grow in a column with none', () => {
    assert.equal('height' in scene(`.p { flex: 1 } ${FULL}`).props(), false);
  });

  it('is kept under a parent stretched across a row', () => {
    const css = `.g { flex-direction: row } ${FULL}`;
    assert.equal(scene(css).props()['height'], '100%');
  });

  it('is no height under a parent a row does not stretch', () => {
    const row = '.g { flex-direction: row; align-items: center }';
    assert.equal('height' in scene(`${row} ${FULL}`).props(), false);
    const self = '.g { flex-direction: row } .p { align-self: flex-start }';
    assert.equal('height' in scene(`${self} ${FULL}`).props(), false);
  });

  it('is kept under a parent placed by its top and bottom', () => {
    const css = `.p { position: absolute; top: 0; bottom: 0 } ${FULL}`;
    assert.equal(scene(css).props()['height'], '100%');
  });

  it('is kept on a box placed out of the flow, which takes it of the box that holds it', () => {
    // Laid out before the box is, so its height is there to take a share of: Chrome makes a
    // `height: 100%` handle track 32 under a switch as tall as its 32 track, with none written.
    const absolute = scene(`.c { position: absolute; height: 100% }`);
    assert.equal(absolute.props()['height'], '100%');
  });

  it('is kept at the top of the app, where the parent is the screen', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(FULL, 'a.css') as never });
    const top = engine.createElement('view');
    engine.setClasses(top, 'c');
    engine.appendChild(engine.root, top);
    engine.commit();
    assert.equal(fabric.committed[0]!.props['height'], '100%');
  });

  it('through percentages: a percentage of a percentage of a height is kept', () => {
    const css = `.g { height: 400px } .p { height: 50% } ${FULL}`;
    assert.equal(scene(css).props()['height'], '100%');
    assert.equal(scene(css).parentProps()['height'], '50%');
    assert.equal('height' in scene(`.p { height: 50% } ${FULL}`).props(), false);
  });

  it('leaves any other height, and a percentage width, as written', () => {
    assert.equal(scene('.c { height: 40px }').props()['height'], 40);
    assert.equal(scene('.c { width: 100% }').props()['width'], '100%');
    assert.equal(scene('.c { min-height: 100% }').props()['minHeight'], '100%');
  });

  it('follows the parent when it gains a height and loses it', () => {
    const s = scene(`.tall { height: 200px } ${FULL}`);
    assert.equal('height' in s.props(), false);
    s.engine.addClass(s.parent, 'tall');
    assert.equal(s.props()['height'], '100%');
    s.engine.removeClass(s.parent, 'tall');
    assert.equal(s.props()['height'] ?? null, null);
  });

  it('follows a height further up, through a parent that grows', () => {
    const s = scene(`.tall { height: 400px } .p { flex: 1 } ${FULL}`);
    assert.equal('height' in s.props(), false);
    s.engine.addClass(s.grand, 'tall');
    assert.equal(s.props()['height'], '100%');
    s.engine.removeClass(s.grand, 'tall');
    assert.equal(s.props()['height'] ?? null, null);
  });

  it('follows a height set inline on the parent', () => {
    const s = scene(FULL);
    assert.equal('height' in s.props(), false);
    s.engine.setProp(s.parent, 'style', { height: 120 });
    assert.equal(s.props()['height'], '100%');
    s.engine.setProp(s.parent, 'style', {});
    assert.equal(s.props()['height'] ?? null, null);
  });
});
