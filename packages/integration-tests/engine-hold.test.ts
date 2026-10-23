/**
 * `Engine.hold`: a node committed while it is held is in the tree, laid out and measurable, and
 * not seen or touched. A library inserts an element, measures it and gives it the class it is
 * shown with before a browser paints it, and native draws each commit as it comes, so what is
 * held for that frame is drawn at no opacity and takes no touch. Let go, it is what it was.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

function scene(css?: string) {
  const fabric = createFakeFabric();
  const globalStyles = css ? (compileCss(css, 'held.css') as StyleSheet) : undefined;
  const engine = new Engine(fabric, 1, { globalStyles });
  const pane = engine.createElement('view');
  engine.setProp(pane, 'nativeID', 'pane');
  const seen = () => {
    engine.commit();
    const node = fabric.committed.find((each) => each.props['nativeID'] === 'pane');
    if (!node) return null;
    const { opacity = null, pointerEvents = null } = node.props;
    return { opacity, pointerEvents };
  };
  return { fabric, engine, pane, seen };
}

describe('a node held unseen', () => {
  it('is committed at no opacity and taking no touch, and is as it was once let go', () => {
    const s = scene();
    s.engine.hold(s.pane, true);
    s.engine.appendChild(s.engine.root, s.pane);
    assert.deepEqual(s.seen(), { opacity: 0, pointerEvents: 'none' });
    s.engine.hold(s.pane, false);
    // A pointerEvents taken off travels as `auto`, and an opacity taken off as nothing.
    assert.deepEqual(s.seen(), { opacity: null, pointerEvents: 'auto' });
  });

  it('gives back an opacity and a pointerEvents of its own', () => {
    const s = scene();
    s.engine.setProp(s.pane, 'style', { opacity: 0.5 });
    s.engine.setProp(s.pane, 'pointerEvents', 'box-none');
    s.engine.appendChild(s.engine.root, s.pane);
    s.engine.hold(s.pane, true);
    assert.deepEqual(s.seen(), { opacity: 0, pointerEvents: 'none' });
    s.engine.hold(s.pane, false);
    assert.deepEqual(s.seen(), { opacity: 0.5, pointerEvents: 'box-none' });
  });

  it('is held over an opacity it is given while held', () => {
    const s = scene();
    s.engine.hold(s.pane, true);
    s.engine.appendChild(s.engine.root, s.pane);
    s.seen();
    s.engine.setProp(s.pane, 'style', { opacity: 0.25 });
    assert.deepEqual(s.seen(), { opacity: 0, pointerEvents: 'none' });
    s.engine.hold(s.pane, false);
    assert.deepEqual(s.seen(), { opacity: 0.25, pointerEvents: 'auto' });
  });

  it('is its eased opacity at once when let go, not eased up from none', () => {
    const s = scene('.pane { opacity: 0.5; transition: opacity 1s linear }');
    s.engine.setClasses(s.pane, 'pane');
    s.engine.hold(s.pane, true);
    s.engine.appendChild(s.engine.root, s.pane);
    assert.deepEqual(s.seen(), { opacity: 0, pointerEvents: 'none' });
    s.engine.hold(s.pane, false);
    assert.deepEqual(s.seen(), { opacity: 0.5, pointerEvents: 'auto' });
  });

  it('commits nothing when it is held as it already is', () => {
    const s = scene();
    s.engine.appendChild(s.engine.root, s.pane);
    s.seen();
    const before = s.fabric.calls.completeRoot;
    s.engine.hold(s.pane, false);
    s.engine.commit();
    assert.equal(s.fabric.calls.completeRoot, before);
  });

  it('leaves nothing behind when it is taken out while held', () => {
    const s = scene();
    s.engine.hold(s.pane, true);
    s.engine.appendChild(s.engine.root, s.pane);
    s.seen();
    s.engine.removeChild(s.engine.root, s.pane);
    assert.equal(s.seen(), null);
    const before = s.fabric.calls.completeRoot;
    // Let go once it is out, as a library's next frame does: nothing of it is committed.
    s.engine.hold(s.pane, false);
    s.engine.commit();
    assert.equal(s.fabric.calls.completeRoot, before);
    // And put back, it is seen.
    s.engine.appendChild(s.engine.root, s.pane);
    assert.deepEqual(s.seen(), { opacity: null, pointerEvents: null });
  });
});
