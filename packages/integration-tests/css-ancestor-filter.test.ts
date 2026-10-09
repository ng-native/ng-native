/**
 * Rules that name an ancestor, and a node none of whose ancestors is one.
 *
 * A library's sheet is mostly selectors of two or more parts: `.mat-mdc-form-field .mdc-label`.
 * Each is offered to every node its last part can be, and matched leftwards from there, up
 * through the node's ancestors. A node a dozen boxes down is asked of a dozen ancestors for each
 * such rule, and almost all of them name an ancestor it has not got. What its ancestors are is
 * gathered once, as a browser's ancestor filter is, and a rule that names one they are not is
 * passed over without a walk.
 *
 * What matches is covered elsewhere, and is the same: these are about the work.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';
import { resetStyleStats, styleStats } from '../fabric/src/css.ts';

const OTHERS = Array.from({ length: 20 }, (_, at) => `.x${at} .c { width: ${at + 1}px }`).join(' ');

/** A `.c` a dozen boxes down, under `top` and then `mid`. */
function deep(css: string, top = 'a', mid = 'm') {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  let at: EngineNode = engine.root;
  const make = (classes: string, name = 'view') => {
    const node = engine.createElement(name);
    if (classes) engine.setClasses(node, classes);
    engine.appendChild(at, node);
    at = node;
    return node;
  };
  const first = make(top);
  for (let depth = 0; depth < 10; depth++) make(depth === 5 ? mid : '');
  const subject = make('c');
  resetStyleStats();
  engine.commit();
  return { engine, first, subject, tests: styleStats.compoundTests };
}

describe('a rule that names an ancestor', () => {
  it('is passed over, with no walk, by a node none of whose ancestors is that', () => {
    const s = deep(`${OTHERS} .a .c { height: 5px }`);
    assert.equal(s.subject.committed!.props['height'], 5);
    assert.equal(s.subject.committed!.props['width'], undefined);
    // Twenty-one tests of the node itself, and one walk up to `.a`: eleven ancestors. A walk
    // for each of the other twenty was two hundred and twenty more.
    assert.ok(s.tests <= 40, `${s.tests} compound tests`);
  });

  it('is still matched by its name, its id, and through a child or a sibling', () => {
    const css =
      `${OTHERS} scroll-view .c { height: 6px } #top .c { margin-top: 7px }` +
      ' .a > .n .c { margin-left: 8px } .a .m + .z .c { margin-right: 9px }';
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
    const make = (parent: EngineNode, classes: string, name = 'view') => {
      const node = engine.createElement(name);
      if (classes) engine.setClasses(node, classes);
      engine.appendChild(parent, node);
      return node;
    };
    const top = make(engine.root, 'a', 'scroll-view');
    engine.setProp(top, 'nativeID', 'top');
    const n = make(top, 'n');
    make(n, 'm');
    const z = make(n, 'z');
    const subject = make(z, 'c');
    engine.commit();
    const props = subject.committed!.props;
    assert.deepEqual(
      [props['height'], props['marginTop'], props['marginLeft'], props['marginRight']],
      [6, 7, 8, 9],
    );
  });

  it('is matched again once an ancestor comes to be what it names, and not once it stops', () => {
    const s = deep(`${OTHERS} .a .c { height: 5px }`, 'plain');
    assert.equal(s.subject.committed!.props['height'], undefined);
    s.engine.setClasses(s.first, 'a');
    s.engine.commit();
    assert.equal(s.subject.committed!.props['height'], 5);
    s.engine.setClasses(s.first, 'plain');
    s.engine.commit();
    assert.equal(s.subject.committed!.props['height'], undefined);
  });
});
