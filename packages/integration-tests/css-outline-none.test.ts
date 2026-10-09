/**
 * An outline of no width, which is what `outline: none` is. It draws nothing, so nothing is sent
 * for it: a view with no outline is the same view. On Android a text field that is given an
 * outline prop after it is first drawn has its background set again, and with that the padding
 * Android gives a text field comes back over the padding it was laid out with. A field as tall
 * as its line then clips its text away. A stylesheet that takes the browser's focus ring off a
 * field says `outline: none` for the focused field alone, which is such an update.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

const OUTLINE = ['outlineWidth', 'outlineStyle', 'outlineColor', 'outlineOffset'];

function scene(css: string, classes: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const box = engine.createElement('view');
  engine.setClasses(box, classes);
  engine.appendChild(engine.root, box);
  /** The outline props the view has, by name. */
  const outline = (): Record<string, unknown> => {
    engine.commit();
    const { props } = fabric.committed[0]!;
    return Object.fromEntries(
      OUTLINE.filter((key) => props[key] != null).map((k) => [k, props[k]]),
    );
  };
  return { engine, box, outline };
}

const CSS =
  '.none { outline: none } .zero { outline: 0 solid red; outline-offset: 2px } ' +
  '.ring { outline: 2px solid red } .off { outline-style: none }';

describe('an outline of no width', () => {
  it('is sent as nothing, however it is written', () => {
    assert.deepEqual(scene(CSS, 'none').outline(), {});
    assert.deepEqual(
      scene(CSS, 'zero').outline(),
      {},
      'with a colour and an offset that draw nothing',
    );
    assert.deepEqual(scene(CSS, 'ring off').outline(), {});
  });

  it('is no change to a view that had no outline: a field that is focused', () => {
    const s = scene(CSS, '');
    assert.deepEqual(s.outline(), {});
    s.engine.addClass(s.box, 'none');
    assert.deepEqual(s.outline(), {});
  });

  it('takes away an outline the view had, and gives way to one again', () => {
    const s = scene(CSS, 'ring');
    assert.deepEqual(s.outline(), {
      outlineWidth: 2,
      outlineStyle: 'solid',
      outlineColor: 'rgb(255, 0, 0)',
    });
    s.engine.setClasses(s.box, 'ring off');
    assert.deepEqual(s.outline(), {});
    s.engine.setClasses(s.box, 'ring');
    assert.equal(s.outline()['outlineWidth'], 2);
  });
});
