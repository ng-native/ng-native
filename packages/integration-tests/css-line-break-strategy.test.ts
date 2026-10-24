/**
 * How wrapped text picks its line breaks: CSS's `text-wrap` (and its longhand `text-wrap-style`)
 * and `word-break: keep-all`, as the paragraph props native breaks lines by. iOS has
 * `lineBreakStrategyIOS`: `standard` is what UILabel and SwiftUI's Text use, which keeps a short
 * word off a line of its own as `text-wrap: pretty` asks, and `hangul-word` keeps a Korean word
 * whole as `word-break: keep-all` does. Android has `textBreakStrategy`, whose `balanced` evens
 * the lines out as `text-wrap: balance` does. Each is inherited, as CSS inherits the properties.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { compileCss, createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const BASE = { width: 400, height: 800, colorScheme: 'light' as const };

/** What one declaration compiles to, with what was dropped. */
function compiled(declaration: string) {
  const dropped: string[] = [];
  const sheet = compileCss(`.a { ${declaration} }`, 'app.css', {
    onUnsupported: (message) => dropped.push(message),
  });
  return { declarations: sheet.rules[0]?.declarations, dropped };
}

const IOS = 'lineBreakStrategyIOS';
const ANDROID = 'textBreakStrategy';

describe('text-wrap and word-break in a stylesheet', () => {
  const cases: [string, Record<string, string>][] = [
    ['text-wrap: pretty', { [IOS]: 'standard', [ANDROID]: 'highQuality' }],
    ['text-wrap-style: pretty', { [IOS]: 'standard', [ANDROID]: 'highQuality' }],
    ['text-wrap: balance', { [IOS]: 'none', [ANDROID]: 'balanced' }],
    ['text-wrap-style: balance', { [IOS]: 'none', [ANDROID]: 'balanced' }],
    ['text-wrap: wrap', { [IOS]: 'none', [ANDROID]: 'highQuality' }],
    ['text-wrap: stable', { [IOS]: 'none', [ANDROID]: 'highQuality' }],
    ['text-wrap-style: auto', { [IOS]: 'none', [ANDROID]: 'highQuality' }],
    ['word-break: keep-all', { [IOS]: 'hangul-word' }],
    ['word-break: normal', { [IOS]: 'none' }],
  ];
  for (const [declaration, expected] of cases) {
    it(`compiles ${declaration} to the line-break strategy native has for it`, () => {
      const { declarations, dropped } = compiled(declaration);
      assert.deepEqual(dropped, []);
      assert.deepEqual(declarations, expected);
    });
  }

  it('refuses text-wrap: nowrap, pointing to white-space', () => {
    const { dropped } = compiled('text-wrap: nowrap');
    assert.equal(dropped.length, 1);
    assert.match(dropped[0]!, /white-space: nowrap/);
  });

  it('refuses a value of text-wrap-style that is not one of its own', () => {
    for (const value of ['wrap', 'nowrap']) {
      const { dropped } = compiled(`text-wrap-style: ${value}`);
      assert.equal(dropped.length, 1, value);
      assert.match(dropped[0]!, /auto, stable, pretty, balance are/, value);
    }
  });

  it('refuses the word-break values native has no switch for', () => {
    for (const value of ['break-all', 'break-word', 'auto-phrase']) {
      assert.equal(compiled(`word-break: ${value}`).dropped.length, 1, value);
    }
  });
});

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

/** A view with `classes` and a text inside it with `inner`, under `css`. */
function scene(css: string, classes: string, inner = '') {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css, 'app.css') as never,
    conditions: BASE,
  });
  const view: EngineNode = engine.createElement('view');
  engine.setClasses(view, classes);
  engine.appendChild(engine.root, view);
  const text: EngineNode = engine.createElement('text');
  engine.setClasses(text, inner);
  engine.appendChild(view, text);
  engine.appendChild(text, engine.createText('Set your working days and hours'));
  const props = (node: EngineNode) => {
    engine.commit();
    return flatten(fabric.committed).find((one) => one.instanceHandle === node)!.props;
  };
  return { engine, view, text, props };
}

describe('a line-break strategy on device', () => {
  it('reaches the text inside the view it is set on', () => {
    const s = scene('.p { text-wrap: pretty }', 'p');
    const props = s.props(s.text);
    assert.equal(props[IOS], 'standard');
    assert.equal(props[ANDROID], 'highQuality');
  });

  it('reaches words written straight into the view', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss('.p { text-wrap: pretty }', 'app.css') as never,
      conditions: BASE,
    });
    const view: EngineNode = engine.createElement('view');
    engine.setClasses(view, 'p');
    engine.appendChild(engine.root, view);
    engine.appendChild(view, engine.createText('Set your working days and hours'));
    engine.commit();
    const paragraphs = flatten(fabric.committed).filter((one) => one.viewName === 'Paragraph');
    assert.equal(paragraphs.length, 1);
    assert.equal(paragraphs[0]!.props[IOS], 'standard');
  });

  it("gives way to the text's own, and comes back when that goes", () => {
    const s = scene('.p { text-wrap: pretty } .b { text-wrap: balance }', 'p', 'b');
    assert.equal(s.props(s.text)[IOS], 'none');
    assert.equal(s.props(s.text)[ANDROID], 'balanced');
    s.engine.setClasses(s.text, '');
    assert.equal(s.props(s.text)[IOS], 'standard');
    assert.equal(s.props(s.text)[ANDROID], 'highQuality');
  });

  it('gives way to a prop set on the text', () => {
    const s = scene('.p { text-wrap: pretty }', '', 'p');
    s.engine.setProp(s.text, IOS, 'push-out');
    assert.equal(s.props(s.text)[IOS], 'push-out');
  });

  it('sends null when the class that set it goes', () => {
    const s = scene('.k { word-break: keep-all }', '', 'k');
    assert.equal(s.props(s.text)[IOS], 'hangul-word');
    s.engine.setClasses(s.text, '');
    const props = s.props(s.text);
    assert.ok(IOS in props, 'sent');
    assert.equal(props[IOS], null);
  });
});
