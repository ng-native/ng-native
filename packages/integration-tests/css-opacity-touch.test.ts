/**
 * A view nothing of is seen that still takes a touch: `opacity: 0` on what is pressed. A browser
 * sends it the press, which is how a library lays a see-through backdrop over the page to hear a
 * press outside a menu. iOS passes over a view whose alpha is under a hundredth, so the press
 * went to whatever was behind.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

function scene(css: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const node = engine.createElement('view');
  engine.setClasses(node, 'a');
  engine.appendChild(engine.root, node);
  const opacity = () => {
    engine.commit();
    return fabric.committed[0]!.props['opacity'] as number;
  };
  return { engine, node, opacity };
}

describe('a view with no opacity that takes a touch', () => {
  it('is committed just seen enough for iOS to send it one, and not seen by anyone', () => {
    const s = scene('.a { opacity: 0 }');
    assert.equal(s.opacity(), 0, 'nothing to press: as written');
    const stop = s.engine.setResponder(s.node, { onStartShouldSetResponder: () => true });
    assert.ok(s.opacity() >= 0.01 && s.opacity() < 0.02, `committed at ${s.opacity()}`);
    stop();
    assert.equal(s.opacity(), 0, 'as written again once it takes none');
  });

  it('leaves one that is told to take no touch as it is', () => {
    const s = scene('.a { opacity: 0; pointer-events: none }');
    s.engine.setResponder(s.node, { onStartShouldSetResponder: () => true });
    assert.equal(s.opacity(), 0);
  });

  it('leaves an opacity that can be seen as it is', () => {
    const s = scene('.a { opacity: 0.4 }');
    s.engine.setResponder(s.node, { onStartShouldSetResponder: () => true });
    assert.equal(s.opacity(), 0.4);
  });
});
