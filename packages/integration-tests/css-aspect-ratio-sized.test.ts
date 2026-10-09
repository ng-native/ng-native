/**
 * `aspect-ratio` on a box with both a width and a height. CSS takes the ratio only for a size
 * that is `auto`, so a box given both is the size it was given. Yoga takes the ratio over one of
 * them: a box 24 by 10 with a ratio of one to two is 5 by 10 in a column and 24 by 48 in a row.
 * So the ratio is committed only where it has a size to work out.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

function scene(css: string, classes: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const box = engine.createElement('view');
  engine.setClasses(box, classes);
  engine.appendChild(engine.root, box);
  const ratio = (): unknown => {
    engine.commit();
    return fabric.committed[0]!.props['aspectRatio'] ?? null;
  };
  return { engine, box, ratio };
}

const CSS =
  '.ratio { aspect-ratio: 1 / 2 } .w { width: 24px } .h { height: 10px } ' +
  '.pw { width: 50% } .auto { height: auto }';

describe('aspect-ratio on a box with both sizes given', () => {
  it('is left out, so the box is the size it was given', () => {
    assert.equal(scene(CSS, 'ratio w h').ratio(), null);
    assert.equal(scene(CSS, 'ratio pw h').ratio(), null, 'a percentage is a size given too');
  });

  it('is kept where a size is left for it to work out', () => {
    assert.equal(scene(CSS, 'ratio').ratio(), 0.5);
    assert.equal(scene(CSS, 'ratio w').ratio(), 0.5);
    assert.equal(scene(CSS, 'ratio h').ratio(), 0.5);
    assert.equal(scene(CSS, 'ratio w h auto').ratio(), 0.5, 'auto is no size given');
  });

  it('follows a size coming and going, and one bound on the element', () => {
    const s = scene(CSS, 'ratio w');
    assert.equal(s.ratio(), 0.5);
    s.engine.addClass(s.box, 'h');
    assert.equal(s.ratio(), null);
    s.engine.removeClass(s.box, 'h');
    assert.equal(s.ratio(), 0.5);
    s.engine.setProp(s.box, 'style', { height: 10 });
    assert.equal(s.ratio(), null);
    s.engine.setProp(s.box, 'style', null);
    assert.equal(s.ratio(), 0.5);
  });
});
