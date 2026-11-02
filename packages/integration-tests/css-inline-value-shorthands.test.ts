/**
 * The shorthands whose parts are of different kinds, in a `style` attribute and in a `[style]`
 * binding: `border`, `outline`, `box-shadow`, `background`, `font` and `text-decoration`. Native
 * has no prop of any of those names that takes the text, so each row is held to what the same
 * declaration commits from a stylesheet, and its computed values to Chrome in `css-oracle.test.ts`.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it, mock } from 'node:test';
import type { Type } from '@angular/core';
import { Engine, parseColor, type EngineNode } from '@ng-native/fabric';
import { NativeRendererFactory } from '@ng-native/platform';
import { compileCss, createFakeFabric, render, type FakeFabricNode } from '@ng-native/testing';
import { compileSource } from './compile.ts';

type Props = Record<string, unknown>;

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

/** A view under a text-coloured parent, styled by `set`, and what it commits. */
function scene(css: string, tag = 'view') {
  const fabric = createFakeFabric();
  const sheet = compileCss(css, 'app.css', { onUnsupported: () => {} });
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never, dev: true } as never);
  const renderer = new NativeRendererFactory(engine).createRenderer(null, null);
  const node = renderer.createElement(tag) as EngineNode;
  renderer.setAttribute(node, 'nativeID', 'probe');
  renderer.setAttribute(node, 'class', 'a');
  renderer.appendChild(engine.root, node);
  const props = (): Props => {
    engine.commit();
    const found = flatten(fabric.committed).find((one) => one.props['nativeID'] === 'probe')!;
    return { ...found.props, ...(found.props['style'] as Props | undefined) };
  };
  return { engine, renderer, node, props };
}

/**
 * The props that say what is drawn, with a colour in one spelling. The style and the colour of a
 * border of no width draw nothing, and `fontStyle: normal` is where a stylesheet's `font` writes
 * nothing, which leaves a weaker rule's italic where Chrome has none (the `font` rows of the oracle).
 */
function drawn(props: Props): Props {
  const out: Props = {};
  const noBorder = props['borderTopWidth'] === 0 && props['borderLeftWidth'] === 0;
  for (const [key, value] of Object.entries(props)) {
    if (key === 'nativeID' || key === 'style' || value === undefined) continue;
    if (noBorder && /^border(\w+)?(Style|Color)$|^borderWidth$/.test(key)) continue;
    if (key === 'fontStyle' && value === 'normal') continue;
    out[key] = spelled(key, value);
  }
  return out;
}

/** A value in one spelling: native reads a weight as a number or as its text. */
function spelled(key: string, value: unknown): unknown {
  if (key === 'fontWeight' && typeof value === 'number') return String(value);
  return /color$/i.test(key) && typeof value === 'string' ? colour(value) : shadow(value);
}

const colour = (text: string): string => parseColor(text)?.join(' ') ?? text;

/** A shadow's or a gradient's colours in the same one spelling. */
function shadow(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) =>
    JSON.parse(JSON.stringify(entry), (key, each: unknown) =>
      key === 'color' && typeof each === 'string' ? colour(each) : each,
    ),
  );
}

const sheetProps = (declaration: string, rule = '', tag?: string) =>
  drawn(scene(`.a { ${rule} } .a { ${declaration} }`, tag).props());

/** The declaration in a static `style` attribute, whole, as the compiler hands one on. */
function attributeProps(declaration: string, rule = '', tag?: string) {
  const { renderer, node, props } = scene(`.a { ${rule} }`, tag);
  renderer.setAttribute(node, 'style', declaration);
  return drawn(props());
}

/** The declaration set as Angular sets a `[style]` or a `[style.x]` binding. */
function boundProps(declaration: string, rule = '', tag?: string) {
  const { renderer, node, props } = scene(`.a { ${rule} }`, tag);
  const at = declaration.indexOf(':');
  renderer.setStyle(node, declaration.slice(0, at).trim(), declaration.slice(at + 1).trim());
  return drawn(props());
}

function assertParity(declaration: string, rule?: string, tag?: string): void {
  const expected = sheetProps(declaration, rule, tag);
  assert.deepEqual(attributeProps(declaration, rule, tag), expected, `attribute: ${declaration}`);
  assert.deepEqual(boundProps(declaration, rule, tag), expected, `binding: ${declaration}`);
}

describe('a shorthand of mixed parts in a style commits what a stylesheet commits', () => {
  const rows: [declaration: string, tag?: string][] = [
    ['border: 2px solid red'],
    ['border: 2px dashed #00f'],
    ['border: dotted 1px rgb(1, 2, 3)'],
    ['border: thin solid red'],
    ['border: 2px double red'],
    ['border: 2px groove red'],
    ['border-top: 2px dashed red'],
    ['border: none'],
    ['border: 0'],
    ['border: 2px'],
    ['border: red'],
    ['border: dashed'],
    ['border: 2px solid'],
    ['border: 2px solid currentColor'],
    ['border-top: 2px solid red'],
    ['border-right: 2px solid red'],
    ['border-bottom: 1px solid'],
    ['border-left: none'],
    ['border-inline: 1px solid red'],
    ['border-inline-start: 1px solid red'],
    ['border-inline-end: 1px solid red'],
    ['border-block: 1px solid red'],
    ['border-block-start: 1px solid red'],
    ['border-block-end: 1px solid red'],
    ['border-width: 2px 3px'],
    ['border-color: red blue'],
    ['border-radius: 4px 8px'],
    ['border-radius: 1px 2px 3px 4px'],
    ['outline: 2px solid red'],
    ['outline: 1px dashed blue'],
    ['outline: none'],
    ['outline: 2px'],
    ['box-shadow: 2px 0 0 red'],
    ['box-shadow: 1px 2px 3px 4px rgba(0, 0, 0, 0.5)'],
    ['box-shadow: inset 0 1px 2px #000'],
    ['box-shadow: red 1px 1px'],
    ['box-shadow: 1px 1px red, 2px 2px blue'],
    ['box-shadow: 1rem 0 red'],
    ['box-shadow: none'],
    ['background: red'],
    ['background: #123456'],
    ['background: rgb(1, 2, 3)'],
    ['background: none'],
    ['background: transparent'],
    ['background: currentColor'],
    ['background: linear-gradient(red, blue)'],
    ['background: linear-gradient(to right, red 10%, blue 90%)'],
    ['background: linear-gradient(90deg, red, blue), linear-gradient(red, blue)'],
    ['background: linear-gradient(red, blue), green'],
    ['font: 12px Arial', 'text'],
    ['font: bold 12px Arial', 'text'],
    ['font: italic 700 12px/20px Georgia, serif', 'text'],
    ['font: italic bold 12px/1.5 "Helvetica Neue", serif', 'text'],
    ['font: normal normal 1rem sans-serif', 'text'],
    ['font: 2em Arial', 'text'],
    ['font: 12px/150% Arial', 'text'],
    ['text-decoration: underline', 'text'],
    ['text-decoration: underline red', 'text'],
    ['text-decoration: underline dotted', 'text'],
    ['text-decoration: underline line-through dashed #00f', 'text'],
    ['text-decoration: red underline', 'text'],
    ['text-decoration: none', 'text'],
  ];
  for (const [declaration, tag] of rows) {
    it(declaration, () => assertParity(declaration, undefined, tag));
  }
});

describe('over what a rule set', () => {
  const rows: [declaration: string, rule: string, tag?: string][] = [
    ['border: 2px solid', 'border-color: blue'],
    ['border: none', 'border: 4px solid blue'],
    ['border-top: 1px solid', 'border-top-color: blue'],
    ['outline: 1px solid', 'outline-color: blue'],
    ['box-shadow: none', 'box-shadow: 1px 1px red'],
    ['border: 2px solid red', 'border-top: none'],
    ['background: red', 'background-image: linear-gradient(red, blue)'],
    ['background: red', 'background-size: 10px; background-position: 4px 4px'],
    ['background: linear-gradient(red, blue)', 'background-color: green'],
    ['background: none', 'background: red'],
    ['text-decoration: underline', 'text-decoration: underline dotted blue', 'text'],
    ['font: bold 12px/20px Arial', 'font-size: 30px; line-height: 40px', 'text'],
  ];
  for (const [declaration, rule, tag] of rows) {
    it(`${declaration} over ${rule}`, () => assertParity(declaration, rule, tag));
  }
});

describe('a line of a token and written parts', () => {
  const token = (declaration: string, value: string | null, rule = '') => {
    const { renderer, node, props, engine } = scene(`.a { ${rule} }`);
    const at = declaration.indexOf(':');
    renderer.setStyle(node, declaration.slice(0, at), declaration.slice(at + 1).trim());
    if (value !== null) renderer.setStyle(node, '--c', value);
    return { renderer, node, props, engine };
  };
  const sheet = (declaration: string, value: string | null, rule = '') =>
    sheetProps(`${value === null ? '' : `--c: ${value};`} ${declaration}`, rule);

  const rows: [declaration: string, value: string | null, rule?: string][] = [
    ['border: 1px solid var(--c)', 'red'],
    ['border: var(--c) solid red', '3px'],
    ['border: 1px var(--c) red', 'dashed'],
    ['border: 1px solid var(--c)', null],
    ['border: 1px solid var(--c)', null, 'border: 4px dashed blue'],
    ['border: 1px solid var(--c, green)', null],
    ['border: 1px solid var(--c)', '2px'],
    ['border-top: 1px solid var(--c)', 'red'],
    ['border-bottom: var(--c) solid red', '3px'],
    ['outline: 1px solid var(--c)', 'red'],
    ['border: none var(--c)', 'red'],
  ];
  for (const [declaration, value, rule] of rows) {
    it(`${declaration} with ${value}`, () => {
      assert.deepEqual(
        drawn(token(declaration, value, rule).props()),
        sheet(declaration, value, rule),
      );
    });
  }

  it('follows the token as it changes and goes, and goes with the binding', () => {
    const { renderer, node, props } = token('border: 1px solid var(--c)', 'red');
    assert.equal(props()['borderTopColor'], 'red');
    renderer.setStyle(node, '--c', 'blue');
    assert.equal(props()['borderLeftColor'], 'blue');
    renderer.removeStyle(node, '--c');
    assert.equal(props()['borderTopWidth'] ?? null, null, 'the token unset makes the line invalid');
    renderer.setStyle(node, '--c', 'blue');
    renderer.removeStyle(node, 'border');
    const after = props();
    assert.equal(after['borderTopWidth'] ?? null, null);
    assert.equal(after['borderTopColor'] ?? null, null);
  });
});

describe('a background over a token in a style', () => {
  const GRADIENT = 'linear-gradient(red, blue)';
  const bound = (value: string, tokens: Record<string, string>, rule = '') => {
    const { renderer, node, props } = scene(`.a { ${rule} }`);
    renderer.setStyle(node, 'background', value);
    for (const [name, each] of Object.entries(tokens)) renderer.setStyle(node, name, each);
    return { renderer, node, props };
  };
  const sheet = (value: string, tokens: Record<string, string>, rule = '') =>
    sheetProps(
      [...Object.entries(tokens).map(([n, each]) => `${n}: ${each}`), `background: ${value}`].join(
        ';',
      ),
      rule,
    );

  const rows: [value: string, tokens: Record<string, string>, rule?: string][] = [
    ['var(--x)', { '--x': 'red' }],
    ['var(--x, green)', {}],
    ['var(--x)', { '--x': 'red' }, 'background-image: linear-gradient(red, blue)'],
    [`${GRADIENT}, var(--x)`, { '--x': 'red' }],
    [`${GRADIENT}, var(--x, green)`, {}],
    [`${GRADIENT}, ${GRADIENT}, var(--x)`, { '--x': 'red' }],
    [`${GRADIENT}, var(--x)`, { '--x': 'red' }, 'background-color: green'],
  ];
  for (const [value, tokens, rule] of rows) {
    it(`${value} with ${JSON.stringify(tokens)}`, () => {
      assert.deepEqual(drawn(bound(value, tokens, rule).props()), sheet(value, tokens, rule));
    });
  }

  it('draws gradients a token holds, from a binding of the token alone', () => {
    const { props } = bound('var(--x)', { '--x': `${GRADIENT}, red` });
    const after = drawn(props());
    assert.equal(after['backgroundColor'], colour('red'));
    assert.equal((after['experimental_backgroundImage'] as unknown[]).length, 1);
  });

  it('follows the token as it changes and goes', () => {
    const { renderer, node, props } = bound(`${GRADIENT}, var(--x)`, { '--x': 'red' });
    assert.equal(props()['backgroundColor'], 'red');
    renderer.setStyle(node, '--x', 'blue');
    assert.equal(props()['backgroundColor'], 'blue');
    renderer.removeStyle(node, 'background');
    const after = props();
    assert.equal(after['backgroundColor'] ?? null, null);
    assert.equal(after['experimental_backgroundImage'] ?? null, null);
  });
});

describe('changing or taking away a shorthand in a style', () => {
  const each: [first: string, second: string, gone: string, kept: string][] = [
    ['2px solid red', '1px dashed blue', 'borderTopWidth', 'borderStyle'],
  ];
  for (const [first, second] of each) {
    it(`from ${first} to ${second}`, () => {
      const { renderer, node, props } = scene('.a { }');
      renderer.setStyle(node, 'border', first);
      props();
      renderer.setStyle(node, 'border', second);
      assert.deepEqual(drawn(props()), sheetProps(`border: ${second}`));
    });
  }

  it('reads a shadow that is all one token', () => {
    const { renderer, node, props } = scene('.a { --s: 1px 2px red }');
    renderer.setStyle(node, 'box-shadow', 'var(--s)');
    assert.deepEqual(drawn(props()), sheetProps('box-shadow: var(--s)', '--s: 1px 2px red'));
  });

  it('keeps a division inside a calc() in a corner', () => {
    const { renderer, node, props } = scene('.a { }');
    renderer.setStyle(node, 'border-radius', 'calc(8px / 2) 2px');
    assert.equal(props()['borderTopLeftRadius'], 4);
    assert.equal(props()['borderTopRightRadius'], 2);
  });

  it('keeps a family of a reserved word when it is quoted', () => {
    const { renderer, node, props } = scene('.a { }', 'text');
    renderer.setStyle(node, 'font', '12px "inherit"');
    assert.equal(props()['fontFamily'], 'inherit');
  });

  it('reads a line in capitals', () => {
    assert.deepEqual(boundProps('border: 2PX SOLID RED'), sheetProps('border: 2px solid red'));
  });

  it('keeps a platform colour as it was written', () => {
    const { renderer, node, props } = scene('.a { }');
    renderer.setStyle(node, 'border', '1px solid platform-color(systemBlue)');
    assert.deepEqual(props()['borderTopColor'], { semantic: ['systemBlue'] });
  });

  it('forgets the token of a line it was before', () => {
    const { renderer, node, props } = scene('.a { }');
    renderer.setStyle(node, 'border', '1px solid var(--c)');
    renderer.setStyle(node, 'border', '2px solid red');
    assert.deepEqual(drawn(props()), sheetProps('border: 2px solid red'));
  });

  const taken: [name: string, value: string, tag?: string][] = [
    ['border', '2px solid red'],
    ['border-top', '2px solid red'],
    ['outline', '2px solid red'],
    ['box-shadow', '1px 1px red'],
    ['background', 'red'],
    ['background', 'linear-gradient(red, blue)'],
    ['font', 'italic bold 12px/1.5 Arial', 'text'],
    ['text-decoration', 'underline red', 'text'],
    ['border-width', '1px 2px'],
    ['border-color', 'red blue'],
    ['border-radius', '1px 2px'],
  ];
  for (const [name, value, tag] of taken) {
    it(`takes ${name}: ${value} away, back to the rule's`, () => {
      const rule = 'border: 9px solid green; background: yellow; text-decoration: overline';
      const before = sheetProps('', rule, tag);
      const { renderer, node, props } = scene(`.a { ${rule} }`, tag);
      renderer.setStyle(node, name, value);
      props();
      renderer.removeStyle(node, name);
      assert.deepEqual(without(drawn(props())), without(before));
    });
  }

  it('takes a static attribute away with what it declared', () => {
    const { renderer, node, props } = scene('.a { }');
    renderer.setAttribute(node, 'style', 'border: 2px solid red; font: 12px Arial');
    props();
    renderer.setAttribute(node, 'style', 'outline: 1px solid red');
    assert.deepEqual(without(drawn(props())), without(sheetProps('outline: 1px solid red')));
    renderer.removeAttribute(node, 'style');
    assert.deepEqual(without(drawn(props())), {});
  });
});

/** A prop sent `null` to clear it says nothing more of what is drawn than one left out. */
const without = (props: Props): Props =>
  Object.fromEntries(
    Object.entries(props).filter(([key, value]) => value != null && key !== 'ellipsizeMode'),
  );

describe('a value a shorthand does not take', () => {
  const refused: [declaration: string, tag?: string][] = [
    ['border: 2px solid red blue'],
    ['border: 1px 2px solid'],
    ['border: solid dashed'],
    ['border: 2px solid notacolour'],
    ['border: constructor solid'],
    ['border: var(--b)'],
    ['outline: var(--o)'],
    ['outline: auto'],
    ['box-shadow: 1px'],
    ['box-shadow: 1px 1px 1px 1px 1px red'],
    ['box-shadow: 1px 1px -1px red'],
    ['box-shadow: 0 0 0 1px var(--c)'],
    ['background: notacolour'],
    ['background: red blue'],
    ['background: url(a.png)'],
    ['background: linear-gradient(red, blue) no-repeat'],
    ['background: linear-gradient(var(--a), blue)'],
    ['background: linear-gradient(red, blue), var(--a), red'],
    ['background: var(--x) none'],
    ['font: 12px', 'text'],
    ['font: Arial', 'text'],
    ['font: caption', 'text'],
    ['font: var(--f)', 'text'],
    ['font: 12px var(--f)', 'text'],
    ['text-decoration: notaline', 'text'],
    ['text-decoration: var(--t)', 'text'],
    ['text-decoration: underline var(--c)', 'text'],
    ['border-radius: 1px 2px 3px 4px 5px'],
    ['border-radius: 4px / 8px'],
    ['border-radius: 4px 8px/2px'],
    ['border-radius: 4px/8px'],
    ['box-shadow: 1px 1px color-mix(in srgb, red 50%, blue)'],
    ['box-shadow: 1px 1px rgb(from red r g b)'],
    ['box-shadow: 1px 1px platform-color(systemBlue)'],
    ['font: 12px inherit', 'text'],
    ['font: 12px Arial, INITIAL', 'text'],
    ['font: 12px default', 'text'],
    ['box-shadow: 1px red 1px'],
    ['background: linear-gradient(red, blue), red, var(--a)'],
    ['text-decoration: none underline', 'text'],
  ];
  for (const [declaration, tag] of refused) {
    it(`drops ${declaration} with a warning`, (t) => {
      const warn = mock.method(console, 'warn', () => {});
      t.after(() => warn.mock.restore());
      const { renderer, node, props, engine } = scene('.a { }', tag);
      assert.equal(engine.dev, true);
      const at = declaration.indexOf(':');
      const name = declaration.slice(0, at);
      renderer.setStyle(node, name, declaration.slice(at + 1).trim());
      assert.deepEqual(without(drawn(props())), {}, 'nothing is committed');
      assert.match(
        String(warn.mock.calls[0]?.arguments[0]),
        new RegExp(`${name}|${name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}`),
      );
    });
  }

  it('takes out the token of a line set before it', () => {
    const { renderer, node, props } = scene('.a { }');
    renderer.setStyle(node, '--c', 'red');
    renderer.setStyle(node, 'border', '1px solid var(--c)');
    props();
    renderer.setStyle(node, 'border', '1px solid notacolour');
    assert.deepEqual(without(drawn(props())), {});
  });

  it('takes out the value set before it', () => {
    const { renderer, node, props } = scene('.a { }');
    renderer.setStyle(node, 'border', '2px solid red');
    renderer.setStyle(node, 'border', '2px solid notacolour');
    assert.deepEqual(without(drawn(props())), {});
  });

  for (const value of ['1px 1px', '1px 1px currentColor']) {
    it(`draws box-shadow: ${value} in the colour of the text`, () => {
      const { renderer, node, props } = scene('.a { color: red }');
      renderer.setStyle(node, 'box-shadow', value);
      const [shadow] = props()['boxShadow'] as { color: string }[];
      assert.equal(colour(shadow!.color), colour('red'));
    });
  }

  it('says a side written in a style only the whole box has is drawn solid', (t) => {
    const warn = mock.method(console, 'warn', () => {});
    t.after(() => warn.mock.restore());
    const { renderer, node, props } = scene('.a { }');
    renderer.setStyle(node, 'border-top', '2px dashed red');
    assert.equal(props()['borderTopWidth'], 2);
    assert.match(String(warn.mock.calls[0]?.arguments[0]), /'dashed' side is drawn solid/);
  });

  it('leaves a shadow written as React Native writes one', () => {
    const { renderer, node, props } = scene('.a { }');
    const written = [{ offsetX: 1, offsetY: 2, color: 'red' }];
    renderer.setStyle(node, 'boxShadow', written);
    assert.deepEqual(props()['boxShadow'], written);
  });
});

describe('from a template', () => {
  it('reads a static attribute and bindings of each', async () => {
    const file = path.join(import.meta.dirname, 'inline-value-shorthands.fixture.ts');
    const mod = await compileSource(
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-shorthands',
  imports: [View],
  template: '<view nativeID="attribute" style="border: 2px solid red"></view><view nativeID="text" [style]="text"></view><view nativeID="object" [style]="object"></view><view nativeID="one" [style.border]="line"></view>',
})
export class Shorthands {
  text = 'border: 2px solid red';
  object = { border: '2px solid red' };
  line = '2px solid red';
}
`,
      file,
      file.replace(/\.ts$/, '.generated.ts'),
    );
    const { fabric } = await render(mod['Shorthands'] as Type<unknown>);
    for (const id of ['attribute', 'text', 'object', 'one']) {
      const node = flatten(fabric.committed).find((each) => each.props['nativeID'] === id)!;
      const style = { ...node.props, ...(node.props['style'] as Props | undefined) };
      assert.equal(style['borderTopWidth'], 2, id);
      assert.equal(colour(style['borderLeftColor'] as string), colour('red'), id);
      assert.equal(style['border'], undefined, id);
    }
  });
});
