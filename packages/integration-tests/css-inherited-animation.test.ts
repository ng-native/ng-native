/**
 * An inherited property an ancestor transitions or animates.
 *
 * In a browser a child inherits the value its parent is animated to this frame, not the one the
 * parent rests at, so a card whose `color` eases eases the text inside it as well. The cascade
 * hands down resting values, so the engine lays its running values over them.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

/** A card holding a label, and under the label a nested run, with a clock the test drives. */
function scene(css: string) {
  let now = 1000;
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css) as StyleSheet,
    now: () => now,
  });
  const card = engine.createElement('view');
  engine.setClasses(card, 'card');
  const label = engine.createElement('text');
  engine.setClasses(label, 'label');
  engine.setProp(label, 'testID', 'label');
  const nested = engine.createElement('text');
  engine.setProp(nested, 'testID', 'nested');
  engine.appendChild(nested, engine.createText('there'));
  engine.appendChild(label, engine.createText('Hi '));
  engine.appendChild(label, nested);
  engine.appendChild(card, label);
  engine.appendChild(engine.root, card);
  engine.commit();

  const propOf = (id: string, key: string) =>
    flatten(fabric.committed).find((n) => n.props['testID'] === id)?.props[key];
  return {
    engine,
    card,
    propOf,
    colourOf: (id: string) => propOf(id, 'color'),
    classes(value: string) {
      engine.setClasses(card, value);
      engine.commit();
    },
    tick(ms: number) {
      now += ms;
      engine.advanceAnimations();
      engine.commit();
    },
  };
}

const easing = `
  .card { color: rgb(0, 0, 0); transition: color 100ms linear; }
  .card.on { color: rgb(200, 100, 0); }
`;

describe('an inherited property an ancestor animates', () => {
  it('eases the text in a view whose colour transitions', () => {
    const s = scene(easing);
    s.classes('card on');
    assert.equal(s.colourOf('label'), 'rgb(0, 0, 0)', 'where the transition starts');
    s.tick(50);
    assert.equal(s.colourOf('label'), 'rgba(100, 50, 0, 1)');
    assert.equal(s.colourOf('nested'), 'rgba(100, 50, 0, 1)', 'and the text inside that');
    s.tick(60);
    assert.equal(s.colourOf('label'), 'rgb(200, 100, 0)');
    assert.equal(s.engine.animating, false);
  });

  it('leaves a text with a colour of its own as it is', () => {
    const s = scene(`${easing} .label { color: rgb(0, 0, 255); }`);
    s.classes('card on');
    s.tick(50);
    assert.equal(s.colourOf('label'), 'rgb(0, 0, 255)');
    assert.equal(s.colourOf('nested'), 'rgb(0, 0, 255)');
  });

  it('eases back from where it was when the change is undone partway', () => {
    const s = scene(easing);
    s.classes('card on');
    s.tick(50);
    s.classes('card');
    assert.equal(s.colourOf('label'), 'rgba(100, 50, 0, 1)');
    s.tick(25);
    assert.equal(s.colourOf('label'), 'rgba(50, 25, 0, 1)');
    s.tick(30);
    assert.equal(s.colourOf('label'), 'rgb(0, 0, 0)');
  });

  it('plays the text in a view whose colour a @keyframes animation plays', () => {
    const s = scene(`
      @keyframes glow { from { color: rgb(0, 0, 0); } to { color: rgb(200, 100, 0); } }
      .card { color: rgb(0, 0, 255); }
      .card.on { animation: glow 100ms linear; }
    `);
    s.classes('card on');
    assert.equal(s.colourOf('label'), 'rgba(0, 0, 0, 1)', 'from the first frame');
    s.tick(50);
    assert.equal(s.colourOf('label'), 'rgba(100, 50, 0, 1)');
    assert.equal(s.colourOf('nested'), 'rgba(100, 50, 0, 1)');
    s.tick(60);
    assert.equal(s.colourOf('label'), 'rgb(0, 0, 255)', 'back to the resting colour once it ends');
  });

  it('gives the text its resting colour again when the animation is taken off', () => {
    const s = scene(`
      @keyframes glow { from { color: rgb(0, 0, 0); } to { color: rgb(200, 100, 0); } }
      .card { color: rgb(0, 0, 255); }
      .card.on { animation: glow 100ms linear; }
    `);
    s.classes('card on');
    s.tick(50);
    s.classes('card');
    assert.equal(s.colourOf('label'), 'rgb(0, 0, 255)');
    assert.equal(s.colourOf('nested'), 'rgb(0, 0, 255)');
  });

  it('hands nothing on for a view taken out of the tree partway', () => {
    const s = scene(easing);
    s.classes('card on');
    s.tick(50);
    assert.equal(s.engine['styles'].handsOn, true);
    s.engine.removeChild(s.engine.root, s.card);
    s.engine.commit();
    assert.equal(s.engine['styles'].handsOn, false);
  });

  it('gives the text the colour it should have when the view comes back', () => {
    const s = scene(easing);
    s.classes('card on');
    s.tick(50);
    s.engine.removeChild(s.engine.root, s.card);
    s.engine.commit();
    s.tick(100);
    s.engine.appendChild(s.engine.root, s.card);
    s.engine.commit();
    assert.equal(s.colourOf('label'), 'rgb(200, 100, 0)');
    assert.equal(s.colourOf('nested'), 'rgb(200, 100, 0)');
  });

  it('eases a font size the text inherits', () => {
    const s = scene(`
      .card { font-size: 10px; transition: font-size 100ms linear; }
      .card.on { font-size: 20px; }
    `);
    s.classes('card on');
    s.tick(50);
    assert.equal(s.propOf('label', 'fontSize'), 15);
    assert.equal(s.propOf('nested', 'fontSize'), 15);
  });
});
