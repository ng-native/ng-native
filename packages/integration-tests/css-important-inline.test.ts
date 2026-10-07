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

  it('stands where it defines a custom property the element sets too', () => {
    const s = scene('.m { --w: 10px !important; width: var(--w) }', 'm', {});
    s.engine.setCustomProperty(s.box, '--w', '50px');
    assert.equal(s.props()['width'], 10);
    const plain = scene('.m { --w: 10px; width: var(--w) }', 'm', {});
    plain.engine.setCustomProperty(plain.box, '--w', '50px');
    assert.equal(plain.props()['width'], 50, 'and is under it where it is not important');
  });

  it('stands over the other form of the same edge, logical or physical', () => {
    const physical = scene('.m { margin-left: 10px !important }', 'm', { marginStart: 20 });
    assert.equal(physical.props()['marginLeft'], 10);
    assert.equal(physical.props()['marginStart'], undefined);
    const logical = scene('.m { margin-inline-start: 10px !important }', 'm', { marginLeft: 20 });
    assert.equal(logical.props()['marginStart'], 10);
    assert.equal(logical.props()['marginLeft'], undefined);
    const mirrored = scene('.m { direction: rtl; margin-right: 10px !important }', 'm', {
      marginStart: 20,
      marginLeft: 5,
    });
    assert.equal(mirrored.props()['marginRight'], 10);
    assert.equal(mirrored.props()['marginStart'], undefined);
    assert.equal(mirrored.props()['marginLeft'], 5, 'and leaves the edge across from it');
  });

  it('is the direction text is aligned by, over one the element sets', () => {
    const fabric = createFakeFabric();
    // A physical side is the other one to a native paragraph laid out right to left.
    const css = '.m { direction: rtl !important; text-align: left }';
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
    const text = engine.createElement('text');
    engine.setClasses(text, 'm');
    engine.setProp(text, 'style', { direction: 'ltr' });
    engine.appendChild(text, engine.createText('One'));
    engine.appendChild(engine.root, text);
    engine.commit();
    assert.equal(fabric.committed[0]!.props['textAlign'], 'right');
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
