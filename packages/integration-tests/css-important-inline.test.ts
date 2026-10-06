/**
 * A declaration a stylesheet marks `!important` stands over the same property in an element's
 * inline style, as it does in a browser: an inline style is the last of the plain declarations,
 * under every important one. A library measures a box by a class that says
 * `height: auto !important` over the height it wrote on the element a moment before.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

/** A box with `classes` and an inline `style`, holding one child, under `css`. */
function scene(css: string, classes: string, style: Record<string, unknown>) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const box = engine.createElement('view');
  engine.setClasses(box, classes);
  engine.setProp(box, 'style', style);
  engine.appendChild(engine.root, box);
  const child = engine.createElement('view');
  engine.setClasses(child, 'child');
  engine.appendChild(box, child);
  const props = (): Record<string, unknown> => {
    engine.commit();
    return fabric.committed[0]!.props;
  };
  const childProps = (): Record<string, unknown> => {
    engine.commit();
    return fabric.committed[0]!.children[0]!.props;
  };
  return { engine, box, props, childProps };
}

describe('an important declaration and an inline style', () => {
  it('stands over the inline style for the same property', () => {
    const s = scene('.m { width: 10px !important }', 'm', { width: 50, height: 20 });
    assert.equal(s.props()['width'], 10);
    assert.equal(s.props()['height'], 20, 'and leaves the inline style every other property');
  });

  it('stands where its value is a custom property', () => {
    const s = scene('.m { --w: 10px; width: var(--w) !important }', 'm', { width: 50 });
    assert.equal(s.props()['width'], 10);
  });

  it('stands for a property that is inherited', () => {
    const s = scene('.m { color: red !important }', 'm', { color: 'blue' });
    assert.equal(s.props()['color'], 'rgb(255, 0, 0)');
  });

  it('is under the inline style where it is not important', () => {
    const s = scene('.m { width: 10px }', 'm', { width: 50 });
    assert.equal(s.props()['width'], 50);
  });

  it('follows the class coming and going, and the inline style changing', () => {
    const s = scene('.m { width: 10px !important }', '', { width: 50 });
    assert.equal(s.props()['width'], 50);
    s.engine.addClass(s.box, 'm');
    assert.equal(s.props()['width'], 10);
    s.engine.setProp(s.box, 'style', { width: 70 });
    assert.equal(s.props()['width'], 10);
    s.engine.removeClass(s.box, 'm');
    assert.equal(s.props()['width'], 70);
  });

  it('is what lays out the boxes inside, where it says which way they run', () => {
    // A basis is committed as the size along its container's main axis.
    const css = '.m { flex-direction: row !important } .child { flex-basis: 80px }';
    const s = scene(css, 'm', { flexDirection: 'column' });
    assert.equal(s.props()['flexDirection'], 'row');
    assert.equal(s.childProps()['width'], 80);
    assert.equal(s.childProps()['height'], undefined);
  });
});
