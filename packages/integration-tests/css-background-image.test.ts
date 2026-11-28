/**
 * A background image in a sheet read as a browser reads it, told by the engine to whoever draws
 * it: what an absolute box in the box it is drawn in is placed against.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { createLaidOutFabric } from './laid-out-fabric.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

describe('an absolute box in a static box with a background image', () => {
  // Chrome would place it against the positioned box above; here the drawn image makes the box
  // it is drawn in positioned, and the engine places what is in it against that box too.
  const CSS =
    '.g { position: relative; width: 400px; height: 200px } ' +
    '.h { position: static; width: 40px; height: 40px } .w { background: url(wall.jpg) } ' +
    '.a { position: absolute; width: 50%; height: 10px; top: 0; left: 0 }';

  const scene = (drawer: boolean) => {
    const fabric = createLaidOutFabric();
    const sheet = compileCss(CSS, 'lib', { generated: true }) as StyleSheet;
    const engine = new Engine(fabric, 1, { globalStyles: sheet });
    if (drawer) engine.setBackgroundDrawer(() => {});
    const add = (name: string, parent: EngineNode) => {
      const node = engine.createElement('view');
      engine.setClasses(node, name);
      engine.setProp(node, 'nativeID', name);
      engine.appendChild(parent, node);
      return node;
    };
    const box = add('h w', add('g', engine.root));
    add('a', box);
    const width = () => {
      engine.commit();
      return fabric.box('a').width;
    };
    return { engine, box, width };
  };

  it('takes a share of the box the image is drawn in where a drawer draws it, and of the one above where not', () => {
    assert.equal(scene(true).width(), 20);
    assert.equal(scene(false).width(), 200);
  });

  it('takes a share of the box above once the image goes, and of its own when it comes back', () => {
    const { engine, box, width } = scene(true);
    assert.equal(width(), 20);
    engine.setClasses(box, 'h');
    assert.equal(width(), 200);
    engine.setClasses(box, 'h w');
    assert.equal(width(), 20);
  });
});
