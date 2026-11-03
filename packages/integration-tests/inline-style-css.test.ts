/**
 * CSS written in a `style` attribute or bound as text, where it means what a stylesheet means by
 * it: a shorthand with a value for each side, and a `line-height` with no unit, which is a
 * multiple of the font size. Native takes neither, and drops what it cannot read without a word.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it, mock } from 'node:test';
import type { Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { render, settle, type FakeFabricNode } from '@ng-native/testing';
import { compileSource } from './compile.ts';

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

async function build(name: string, source: string): Promise<Record<string, unknown>> {
  const file = path.join(import.meta.dirname, `inline-style-css-${name}.fixture.ts`);
  return compileSource(source, file, file.replace(/\.ts$/, '.generated.ts'));
}

/** The style props of the node with `id`, the given ones only. */
function styleOf(fabric: { committed: readonly FakeFabricNode[] }, id: string, keys: string[]) {
  const node = flatten(fabric.committed).find((one) => one.props['nativeID'] === id)!;
  const style = (node.props['style'] ?? {}) as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, node.props[key] ?? style[key]]));
}

const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
const padding = ['padding', ...SIDES.map((side) => `padding${side}`)];

describe('a shorthand with several values in a style', () => {
  it('goes to each side from a style attribute', async () => {
    const mod = await build(
      'sides',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-sides',
  imports: [View],
  template: '<view nativeID="box" style="padding: 4px 8px; margin: 1px 2px 3px 4px; gap: 5px 6px; inset: 0 7px 9px"></view>',
})
export class Sides {}
`,
    );
    const { fabric } = await render(mod['Sides'] as Type<unknown>);
    assert.deepEqual(styleOf(fabric, 'box', padding), {
      padding: undefined,
      paddingTop: 4,
      paddingRight: 8,
      paddingBottom: 4,
      paddingLeft: 8,
    });
    assert.deepEqual(styleOf(fabric, 'box', ['margin', ...SIDES.map((side) => `margin${side}`)]), {
      margin: undefined,
      marginTop: 1,
      marginRight: 2,
      marginBottom: 3,
      marginLeft: 4,
    });
    assert.deepEqual(styleOf(fabric, 'box', ['gap', 'rowGap', 'columnGap']), {
      gap: undefined,
      rowGap: 5,
      columnGap: 6,
    });
    assert.deepEqual(styleOf(fabric, 'box', ['inset', 'top', 'right', 'bottom', 'left']), {
      inset: undefined,
      top: 0,
      right: 7,
      bottom: 9,
      left: 7,
    });
  });

  it('reads a declaration marked important as a bound one is read', async () => {
    const mod = await build(
      'important',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-important',
  imports: [View],
  template: '<view nativeID="box" style="padding: 4px 8px !important; margin: 4px ! IMPORTANT; border-width: 2px !important"></view>',
})
export class Important {}
`,
    );
    const { fabric } = await render(mod['Important'] as Type<unknown>);
    assert.deepEqual(styleOf(fabric, 'box', padding), {
      padding: undefined,
      paddingTop: 4,
      paddingRight: 8,
      paddingBottom: 4,
      paddingLeft: 8,
    });
    assert.deepEqual(styleOf(fabric, 'box', ['margin', 'borderWidth']), {
      margin: 4,
      borderWidth: 2,
    });
  });

  it('splits on CSS whitespace outside parentheses', async () => {
    const mod = await build(
      'split',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-split',
  imports: [View],
  template: \`
    <view nativeID="calc" style="padding: 4px calc(2px + 2px)"></view>
    <view nativeID="right" style="padding-right: calc(2px + 2px)"></view>
    <view nativeID="tabbed" style="margin:\t1px\n2px"></view>
    <view nativeID="nbsp" style="margin: 1px 2px"></view>
  \`,
})
export class Split {}
`,
    );
    const { fabric } = await render(mod['Split'] as Type<unknown>);
    const right = styleOf(fabric, 'right', ['paddingRight'])['paddingRight'];
    assert.deepEqual(styleOf(fabric, 'calc', padding), {
      padding: undefined,
      paddingTop: 4,
      paddingRight: right,
      paddingBottom: 4,
      paddingLeft: right,
    });
    assert.deepEqual(styleOf(fabric, 'tabbed', ['marginTop', 'marginRight']), {
      marginTop: 1,
      marginRight: 2,
    });
    // A no-break space is no CSS whitespace: the value is one word, and not split.
    assert.deepEqual(styleOf(fabric, 'nbsp', ['marginTop', 'marginRight']), {
      marginTop: undefined,
      marginRight: undefined,
    });
  });

  it('drops one with too many values, with a warning, as a browser drops it', async () => {
    const mod = await build(
      'many',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-many',
  imports: [View],
  template: \`
    <view nativeID="sheet" class="p"></view>
    <view nativeID="many" class="p" style="padding: 1px 2px 3px 4px 5px; gap: 1px 2px 3px"></view>
  \`,
  styles: '.p { padding: 3px; gap: 2px; }',
})
export class Many {}
`,
    );
    const warnings: string[] = [];
    mock.method(console, 'warn', (message: string) => warnings.push(message));
    try {
      const { fabric } = await render(mod['Many'] as Type<unknown>, { dev: true });
      const keys = [...padding, 'gap', 'rowGap', 'columnGap'];
      assert.deepEqual(styleOf(fabric, 'many', keys), styleOf(fabric, 'sheet', keys));
      assert.equal(warnings.length, 2, warnings.join('\n'));
      assert.match(warnings[0]!, /padding: 1px 2px 3px 4px 5px.*<view>.*dropped/);
      assert.match(warnings[1]!, /gap: 1px 2px 3px.*<view>.*dropped/);
    } finally {
      mock.restoreAll();
    }
  });

  it('drops one with a part a browser drops, whole, with a warning', async () => {
    const mod = await build(
      'refused-part',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-refused-part',
  imports: [View],
  template: \`
    <view nativeID="sheet" class="p"></view>
    <view nativeID="negative" class="p" style="padding: 1px -1px"></view>
    <view nativeID="math" class="p" style="padding: 1px calc(1px + 2)"></view>
  \`,
  styles: '.p { padding: 3px; }',
})
export class RefusedPart {}
`,
    );
    const warnings: string[] = [];
    mock.method(console, 'warn', (message: string) => warnings.push(message));
    try {
      const { fabric } = await render(mod['RefusedPart'] as Type<unknown>, { dev: true });
      assert.deepEqual(styleOf(fabric, 'negative', padding), styleOf(fabric, 'sheet', padding));
      assert.deepEqual(styleOf(fabric, 'math', padding), styleOf(fabric, 'sheet', padding));
      assert.equal(warnings.length, 2, warnings.join('\n'));
      assert.match(warnings[0]!, /padding: 1px -1px.*negative, in paddingRight.*dropped/);
      assert.match(warnings[1]!, /padding: 1px calc\(1px \+ 2\).*no type.*paddingRight.*dropped/);
    } finally {
      mock.restoreAll();
    }
  });

  it('follows a binding to one value, and to none', async () => {
    const mod = await build(
      'bound',
      `
import { Component, signal } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-bound',
  imports: [View],
  template: '<view nativeID="box" [style.padding]="pad()"></view>',
})
export class Bound { readonly pad = signal<string | undefined>('4px 8px'); }
`,
    );
    const { fabric, instance } = await render(
      mod['Bound'] as Type<{ pad: { set(value: string | undefined): void } }>,
    );
    assert.equal(styleOf(fabric, 'box', padding)['paddingRight'], 8);

    instance.pad.set('2px');
    await settle();
    assert.deepEqual(styleOf(fabric, 'box', padding), {
      padding: 2,
      paddingTop: undefined,
      paddingRight: undefined,
      paddingBottom: undefined,
      paddingLeft: undefined,
    });

    instance.pad.set('1px 3px');
    await settle();
    instance.pad.set(undefined);
    await settle();
    assert.deepEqual(
      styleOf(fabric, 'box', padding),
      Object.fromEntries(padding.map((key) => [key, undefined])),
    );
  });
});

describe('a side shorthand bound beside one of its sides', () => {
  it('leaves the side alone once the shorthand is one value again', async () => {
    const mod = await build(
      'side',
      `
import { Component, signal } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-side',
  imports: [View],
  template: '<view nativeID="box" [style.padding]="pad()" [style.padding-top.px]="top()"></view>',
})
export class Side {
  readonly pad = signal('4px 8px');
  readonly top = signal<number | undefined>(undefined);
}
`,
    );
    const { fabric, instance } = await render(
      mod['Side'] as Type<{
        pad: { set(value: string): void };
        top: { set(value: number): void };
      }>,
    );
    instance.pad.set('2px');
    await settle();
    instance.top.set(5);
    await settle();
    instance.pad.set('3px');
    await settle();
    assert.deepEqual(styleOf(fabric, 'box', ['padding', 'paddingTop']), {
      padding: 3,
      paddingTop: 5,
    });
  });
});

describe('a line-height with no unit in a style', () => {
  it('is a multiple of the font size, as in a stylesheet', async () => {
    const mod = await build(
      'line',
      `
import { Component } from '@angular/core';
import { Text } from '../components/src/text.ts';
@Component({
  selector: 'x-line',
  imports: [Text],
  template: \`
    <text nativeID="attribute" style="line-height: 1.5; font-size: 20px">a</text>
    <text nativeID="bound" [style.line-height]="'1.5'" [style.font-size.px]="20">b</text>
    <text nativeID="sheet" class="c">c</text>
    <text nativeID="points" [style]="{ lineHeight: 24, fontSize: 20 }">d</text>
  \`,
  styles: '.c { line-height: 1.5; font-size: 20px; }',
})
export class Line {}
`,
    );
    const { fabric } = await render(mod['Line'] as Type<unknown>);
    const line = (id: string) => styleOf(fabric, id, ['lineHeight'])['lineHeight'];
    assert.equal(line('sheet'), 30, 'control: the stylesheet');
    assert.equal(line('attribute'), 30);
    assert.equal(line('bound'), 30);
    assert.equal(line('points'), 24, 'a number in a style object is points, as in React Native');
  });

  it('hands down the number, not the points, as a stylesheet does', async () => {
    const mod = await build(
      'inherit',
      `
import { Component } from '@angular/core';
import { Text } from '../components/src/text.ts';
@Component({
  selector: 'x-inherit',
  imports: [Text],
  template: \`
    <text class="c"><text nativeID="sheet" style="font-size: 40px">a</text></text>
    <text style="line-height: 1.5; font-size: 20px"><text nativeID="attribute" style="font-size: 40px">b</text></text>
    <text [style.line-height]="'1.5'" [style.font-size.px]="20"><text nativeID="bound" style="font-size: 40px">c</text></text>
    <text [style.line-height]="1.5" [style.font-size.px]="20"><text nativeID="number" style="font-size: 40px">d</text></text>
  \`,
  styles: '.c { line-height: 1.5; font-size: 20px; }',
})
export class Inherit {}
`,
    );
    const { fabric } = await render(mod['Inherit'] as Type<unknown>);
    const line = (id: string) => styleOf(fabric, id, ['lineHeight'])['lineHeight'];
    assert.equal(line('sheet'), 60, 'control: the stylesheet');
    assert.equal(line('attribute'), 60);
    assert.equal(line('bound'), 60);
    assert.equal(line('number'), 60, 'a number bound to line-height is the CSS number');
  });

  it('reads the CSS number grammar, and refuses a negative one with a warning', async () => {
    const mod = await build(
      'grammar',
      `
import { Component } from '@angular/core';
import { Text } from '../components/src/text.ts';
@Component({
  selector: 'x-grammar',
  imports: [Text],
  template: \`
    <text nativeID="plus" style="line-height: +1.5; font-size: 20px">a</text>
    <text nativeID="exponent" style="line-height: 1e0; font-size: 20px">b</text>
    <text nativeID="sheet" class="c">c</text>
    <text nativeID="negative" class="c" style="line-height: -1.5">d</text>
    <text nativeID="negative-em" class="c" [style.line-height]="'-1em'">e</text>
  \`,
  styles: '.c { line-height: 2; font-size: 20px; }',
})
export class Grammar {}
`,
    );
    const warnings: string[] = [];
    mock.method(console, 'warn', (message: string) => warnings.push(message));
    try {
      const { fabric } = await render(mod['Grammar'] as Type<unknown>, { dev: true });
      const line = (id: string) => styleOf(fabric, id, ['lineHeight'])['lineHeight'];
      assert.equal(line('plus'), 30);
      assert.equal(line('exponent'), 20);
      assert.equal(line('sheet'), 40, 'control: the stylesheet');
      assert.equal(line('negative'), 40, 'the declaration is dropped, and the rule stands');
      assert.equal(line('negative-em'), 40);
      assert.equal(warnings.length, 2, warnings.join('\n'));
      assert.match(warnings[0]!, /line-height: -1\.5.*<text>.*dropped/);
      assert.match(warnings[1]!, /line-height: -1em.*<text>.*dropped/);
    } finally {
      mock.restoreAll();
    }
  });
});

describe('a flex in a style', () => {
  const FLEX = ['flex', 'flexGrow', 'flexShrink', 'flexBasis'];
  const VALUES = [
    '1 1 auto',
    '2 3',
    '1 0 10px',
    '30%',
    '2 25%',
    'none',
    'auto',
    '1 1 0',
    // A zero of any spelling, and a length with a sign or an exponent, as a browser reads them.
    '1 1 0.0',
    '1 1 -0',
    '1 1 +10px',
    '1 1 1e2px',
  ];

  it('is the grow, shrink and basis a stylesheet makes of it', async () => {
    const pairs = VALUES.map(
      (value, i) =>
        `<view nativeID="sheet${i}" class="f${i}"></view><view nativeID="attribute${i}" style="flex: ${value}"></view>`,
    ).join('');
    const rules = VALUES.map((value, i) => `.f${i} { flex: ${value}; }`).join(' ');
    const mod = await build(
      'flex',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-flex',
  imports: [View],
  template: '${pairs}',
  styles: '${rules}',
})
export class Flex {}
`,
    );
    const { fabric } = await render(mod['Flex'] as Type<unknown>);
    VALUES.forEach((value, i) => {
      const sheet = styleOf(fabric, `sheet${i}`, FLEX);
      assert.equal(sheet['flex'], undefined, `control: the stylesheet's flex: ${value}`);
      assert.deepEqual(styleOf(fabric, `attribute${i}`, FLEX), sheet, `flex: ${value}`);
    });
  });

  it('follows a binding from one value to another, and to none', async () => {
    const mod = await build(
      'flex-bound',
      `
import { Component, signal } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-flex-bound',
  imports: [View],
  template: '<view nativeID="box" [style.flex]="flex()"></view>',
})
export class FlexBound { readonly flex = signal<string | undefined>('1 1 auto'); }
`,
    );
    const { fabric, instance } = await render(
      mod['FlexBound'] as Type<{ flex: { set(value: string | undefined): void } }>,
    );
    assert.deepEqual(styleOf(fabric, 'box', FLEX), {
      flex: undefined,
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 'auto',
    });

    // One number is React Native's own flex, as a style object writes it.
    instance.flex.set('2');
    await settle();
    assert.deepEqual(styleOf(fabric, 'box', FLEX), {
      flex: 2,
      flexGrow: undefined,
      flexShrink: undefined,
      flexBasis: undefined,
    });

    instance.flex.set('none');
    await settle();
    assert.deepEqual(styleOf(fabric, 'box', FLEX), {
      flex: undefined,
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: 'auto',
    });

    instance.flex.set(undefined);
    await settle();
    assert.deepEqual(
      styleOf(fabric, 'box', FLEX),
      Object.fromEntries(FLEX.map((key) => [key, undefined])),
    );
  });

  it('drops one that is no flex, with a warning, as a browser drops it', async () => {
    const mod = await build(
      'flex-refused',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-flex-refused',
  imports: [View],
  template: '<view nativeID="sheet" class="f"></view><view nativeID="many" class="f" style="flex: 1 2 3px 4"></view><view nativeID="negative" class="f" style="flex: 1 -10px"></view><view nativeID="word" class="f" style="flex: constructor"></view><view nativeID="banana" class="f" style="flex: 1 banana"></view>',
  styles: '.f { flex: 2 0 5px; }',
})
export class FlexRefused {}
`,
    );
    const warnings: string[] = [];
    mock.method(console, 'warn', (message: string) => warnings.push(message));
    try {
      const { fabric } = await render(mod['FlexRefused'] as Type<unknown>, { dev: true });
      const sheet = styleOf(fabric, 'sheet', FLEX);
      assert.deepEqual(styleOf(fabric, 'many', FLEX), sheet);
      assert.deepEqual(styleOf(fabric, 'negative', FLEX), sheet);
      assert.deepEqual(styleOf(fabric, 'word', FLEX), sheet, 'a name on Object.prototype');
      assert.deepEqual(styleOf(fabric, 'banana', FLEX), sheet, 'a basis that is no length');
      assert.equal(warnings.length, 4, warnings.join('\n'));
      assert.match(warnings[0]!, /flex: 1 2 3px 4.*<view>.*dropped/);
      assert.match(warnings[1]!, /flex: 1 -10px.*<view>.*dropped/);
      assert.match(warnings[2]!, /flex: constructor.*<view>.*dropped/);
      assert.match(warnings[3]!, /flex: 1 banana.*<view>.*dropped/);
    } finally {
      mock.restoreAll();
    }
  });
});

describe('an absolute calc() in a style', () => {
  const KEYS = ['flexGrow', 'flexShrink', 'flexBasis', 'width', 'height', 'minWidth'];
  KEYS.push('marginTop', 'marginRight', 'paddingRight');
  const DECLARATIONS = [
    'flex: 1 1 calc(10px + 10px)',
    'flex-basis: calc(10px + 10px)',
    'width: calc(2 * 1rem)',
    'height: calc((2px + 3px) * 2)',
    'min-width: calc(10px / 4)',
    'margin: calc(1px + 1px) calc(8px - 2px)',
    'padding-right: calc(1rem - 4px)',
    // A share of the box with a length added is the engine's to finish, from a style as from a
    // stylesheet.
    'width: calc(100% - 10px)',
  ];

  it('is the length a stylesheet makes of it', async () => {
    const pairs = DECLARATIONS.map(
      (declaration, i) =>
        `<view nativeID="sheet${i}" class="c${i}"></view><view nativeID="attribute${i}" style="${declaration}"></view>`,
    ).join('');
    const rules = DECLARATIONS.map((declaration, i) => `.c${i} { ${declaration}; }`).join(' ');
    const mod = await build(
      'calc',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-calc',
  imports: [View],
  template: '${pairs}',
  styles: '${rules}',
})
export class Calc {}
`,
    );
    const { fabric } = await render(mod['Calc'] as Type<unknown>);
    DECLARATIONS.forEach((declaration, i) => {
      const sheet = styleOf(fabric, `sheet${i}`, KEYS);
      if (!declaration.includes('%')) {
        assert.ok(
          Object.values(sheet).some((value) => typeof value === 'number'),
          `control: the stylesheet's ${declaration}`,
        );
      }
      assert.deepEqual(styleOf(fabric, `attribute${i}`, KEYS), sheet, declaration);
    });
  });

  it('drops one that comes to no length, as a stylesheet does, and says so', async () => {
    const REFUSED = [
      'calc(10px+10px)',
      'calc(10px+ 10px)',
      'calc(10px +10px)',
      'calc(10px * 2px)',
      'calc(2 / 1px * 3px)',
      'calc(3)',
      'calc(1px + 2)',
    ];
    const views = REFUSED.map(
      (value, i) =>
        `<view nativeID="sheet${i}" class="r${i}"></view><view nativeID="attribute${i}" style="width: ${value}"></view>`,
    ).join('');
    const rules = REFUSED.map((value, i) => `.r${i} { width: ${value}; }`).join(' ');
    const mod = await build(
      'calc-refused',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-calc-refused',
  imports: [View],
  template: '${views}',
  styles: '${rules}',
})
export class CalcRefused {}
`,
    );
    const warnings: string[] = [];
    mock.method(console, 'warn', (message: string) => warnings.push(message));
    try {
      const { fabric } = await render(mod['CalcRefused'] as Type<unknown>, { dev: true });
      REFUSED.forEach((value, i) => {
        assert.equal(styleOf(fabric, `sheet${i}`, ['width'])['width'], undefined, value);
        assert.equal(styleOf(fabric, `attribute${i}`, ['width'])['width'], undefined, value);
        assert.ok(
          warnings.some((message) => message.includes(`width: ${value}, in a style on <view>`)),
          `no warning for ${value}: ${warnings.join('\n')}`,
        );
      });
    } finally {
      mock.restoreAll();
    }
  });

  it('reads a bound one with CSS whitespace around it, and not with a no-break space', async () => {
    const mod = await build(
      'calc-padded',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-calc-padded',
  imports: [View],
  template: \`
    <view nativeID="padded" [style.width]="' calc(3 * 4px)\\t'"></view>
    <view nativeID="nbsp" [style.width]="'calc(3 * 4px)\\u00a0'"></view>
    <view nativeID="attribute" [attr.style]="'width: calc(3 * 4px)\\u00a0'"></view>
  \`,
})
export class CalcPadded {}
`,
    );
    const { fabric } = await render(mod['CalcPadded'] as Type<unknown>);
    assert.equal(styleOf(fabric, 'padded', ['width'])['width'], 12);
    // A no-break space is no CSS whitespace: the value is no calc() at all.
    assert.equal(styleOf(fabric, 'nbsp', ['width'])['width'], 'calc(3 * 4px)\u00a0');
    assert.equal(styleOf(fabric, 'attribute', ['width'])['width'], 'calc(3 * 4px)\u00a0');
  });

  it('is a length from a binding, and follows it', async () => {
    const mod = await build(
      'calc-bound',
      `
import { Component, signal } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-calc-bound',
  imports: [View],
  template: \`
    <view nativeID="calc" [style.flex]="flex()" [style.width]="width()"></view>
    <view nativeID="points" [style.flex]="flexPoints()" [style.width]="widthPoints()"></view>
  \`,
})
export class CalcBound {
  readonly flex = signal('1 1 calc(10px + 10px)');
  readonly width = signal('calc(3 * 4px)');
  readonly flexPoints = signal('1 1 20px');
  readonly widthPoints = signal('12px');
}
`,
    );
    type Bound = { set(value: string): void };
    const { fabric, instance } = await render(
      mod['CalcBound'] as Type<Record<'flex' | 'width' | 'flexPoints' | 'widthPoints', Bound>>,
    );
    const keys = ['flexBasis', 'height', 'width'];
    const points = styleOf(fabric, 'points', keys);
    assert.equal(points['width'], 12, 'control: the points written out');
    assert.deepEqual(styleOf(fabric, 'calc', keys), points);

    instance.flex.set('1 1 calc(1rem / 2)');
    instance.width.set('calc(15px - 10px)');
    instance.flexPoints.set('1 1 8px');
    instance.widthPoints.set('5px');
    await settle();
    assert.deepEqual(styleOf(fabric, 'calc', keys), styleOf(fabric, 'points', keys));
  });
});

describe('a math function in a style', () => {
  const KEYS = ['width', 'height', 'minWidth', 'maxHeight', 'top', 'marginTop', 'marginRight'];
  KEYS.push('fontSize', 'lineHeight', 'letterSpacing', 'borderTopLeftRadius', 'opacity');
  KEYS.push('flexGrow', 'flexShrink', 'flexBasis', 'aspectRatio', 'fontWeight', 'transform');
  const DECLARATIONS = [
    // Lengths.
    'width: min(10px, 20px)',
    'width: max(10px, 20px)',
    'width: clamp(10px, 20px, 30px)',
    'width: clamp(10px, 50px, 30px)',
    'width: clamp(10px, 5px, 30px)',
    'width: min(10px, 2rem, 5px)',
    'width: calc(min(10px, 20px) + 1px)',
    'width: MIN(10PX, 20PX)',
    'font-size: calc(1em + 2px)',
    'font-size: calc(150%)',
    'font-size: min(1em, 2em)',
    'width: calc(1em + 2px)',
    'width: calc((1vw + 1rem) * 2)',
    'width: calc(100vw - 10px)',
    'height: calc(100vh - 1px)',
    'top: calc(100vmin / 2)',
    'max-height: calc(100vmax - 1rem)',
    'margin: calc(1em + 2px) 4px',
    'letter-spacing: calc(1em / 10)',
    'flex-basis: calc(1em + 2px)',
    'flex: 1 1 calc(1em + 2px)',
    'flex: 1 1 min(10px, 20px)',
    'width: calc(50%)',
    'width: calc(50% + 0px)',
    'width: calc(50% * 2)',
    'width: calc(100% / 3)',
    'width: max(50%, 10%)',
    'width: calc(100% - 2rem)',
    'line-height: calc(1em + 2px)',
    'line-height: calc(10px + 2px)',
    'line-height: calc(150%)',
    // Numbers.
    'opacity: calc(1 / 2)',
    'opacity: calc(50%)',
    'opacity: calc(50% + 10%)',
    'opacity: min(1, 0.5)',
    'opacity: clamp(0, 2, 1)',
    'flex-grow: calc(1 + 1)',
    'flex-shrink: calc(1 + 1)',
    'aspect-ratio: calc(16 / 9)',
    'line-height: calc(1 + 1)',
    'font-weight: calc(300 + 400)',
    'flex: calc(1 + 1)',
    'flex: calc(1 + 1) 1 0px',
    'flex: calc(1 + 1) calc(2 + 1)',
    'flex: 1 calc(1 + 1) 10px',
    // Transforms.
    'transform: translateX(calc(1px + 1px))',
    'transform: scale(calc(1 + 1))',
    'transform: rotate(calc(10deg + 20deg))',
    'transform: translate(calc(1px + 1px), calc(1rem * 2))',
    'transform: rotate(calc(1turn / 4))',
    'transform: translateX(min(1px, 2px))',
    'transform: scale(min(1, 2))',
    'transform: rotate(max(1deg, 2deg))',
    'transform: translateX(calc(50%))',
    'transform: perspective(calc(10px * 2))',
    'transform: scale(calc(1 + 1), 2) rotate(calc(1deg + 1deg))',
    'transform: translateX(calc(1em + 1px))',
    'transform: translateX(calc(1vw + 1px))',
    'transform: translateX(1em) scale(calc(1 + 1))',
  ];

  let renderings = 0;

  /** A style with `scale`, which a style commits for both axes, spelt as a stylesheet spells it. */
  function bothAxes(style: Record<string, unknown>) {
    const transform = style['transform'] as Record<string, unknown>[] | undefined;
    return {
      ...style,
      transform: transform?.flatMap((entry) =>
        'scale' in entry ? [{ scaleX: entry['scale'] }, { scaleY: entry['scale'] }] : [entry],
      ),
    };
  }

  /** The sheet, the static attribute and a [style] binding of each declaration, side by side. */
  async function renderEach(declarations: readonly string[]) {
    const views = declarations
      .map(
        (declaration, i) =>
          `<view nativeID="sheet${i}" class="c${i}"></view><view nativeID="attribute${i}" style="${declaration}"></view><view nativeID="bound${i}" [style]="rows[${i}]"></view>`,
      )
      .join('');
    const rules = declarations.map((declaration, i) => `.c${i} { ${declaration}; }`).join(' ');
    const mod = await build(
      `math-${renderings++}`,
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-math',
  imports: [View],
  template: '<view style="font-size: 16px">${views}</view>',
  styles: '${rules}',
})
export class MathRows {
  readonly rows = ${JSON.stringify(declarations)};
}
`,
    );
    return render(mod['MathRows'] as Type<unknown>, {
      conditions: { width: 400, height: 800, colorScheme: 'light' },
    });
  }

  it('is what a stylesheet makes of it, from an attribute and from a binding', async () => {
    const { fabric } = await renderEach(DECLARATIONS);
    DECLARATIONS.forEach((declaration, i) => {
      const sheet = styleOf(fabric, `sheet${i}`, KEYS);
      assert.ok(
        Object.values(sheet).some((value) => value !== undefined),
        `control: the stylesheet's ${declaration}`,
      );
      const inline = (id: string) => bothAxes(styleOf(fabric, id, KEYS));
      assert.deepEqual(inline(`attribute${i}`), sheet, `attribute: ${declaration}`);
      assert.deepEqual(inline(`bound${i}`), sheet, `binding: ${declaration}`);
    });
  });

  it('settles a padding in em on every side, as one value', async () => {
    const { fabric } = await renderEach(['padding: calc(1em + 2px)']);
    assert.equal(styleOf(fabric, 'sheet0', ['paddingTop'])['paddingTop'], 18);
    assert.equal(styleOf(fabric, 'attribute0', ['padding'])['padding'], 18);
    assert.equal(styleOf(fabric, 'bound0', ['padding'])['padding'], 18);
  });

  it('drops what CSS refuses and says so, and leaves what cannot be worked out as written', async () => {
    const REFUSED: [string, string][] = [
      ['width', 'calc(3)'],
      ['width', 'calc(1 + 1)'],
      ['width', 'calc(1px + 2)'],
      ['width', 'calc(50% + 2)'],
      ['width', 'calc(1em * 1em)'],
      ['width', 'calc(1 / 1em)'],
      ['width', 'min(1px, 2)'],
      ['width', 'min(1px + 50%, 2)'],
      ['width', 'calc(1deg + 1deg)'],
      ['width', 'calc(1px + 1deg)'],
      ['opacity', 'calc(1px)'],
      ['opacity', 'calc(50% + 1)'],
      ['color', 'calc(1px + 1px)'],
      ['flexGrow', 'calc(50%)'],
      ['aspectRatio', 'calc(1px)'],
      ['fontWeight', 'calc(1px)'],
    ];
    const LEFT: [string, string][] = [
      ['width', 'calc(1em + 1vw)'],
      ['width', 'calc(50% + 1em)'],
      ['width', 'calc(1px / 0)'],
      ['width', 'min(1em, 2px)'],
      ['width', 'min(1em, 2vw)'],
      ['width', 'min(50%, 1px)'],
      ['width', 'min(1em + 1px, 2em)'],
      ['width', 'min(1px + 50%, 2px)'],
      // Not read here, and not said to be refused: CSS has both of these.
      ['width', 'calc(1cm + 1px)'],
      ['width', 'calc(var(--x) + 2)'],
      ['width', 'calc(2 + 1px + var(--x))'],
      ['scale', 'calc(1 + 1)'],
      ['flexGrow', 'calc(1 / 0)'],
      // A shape the reader gives up on, which is not a type it can name.
      ['width', 'clamp(1px, 2px)'],
      ['width', 'min()'],
      ['width', 'calc(1px, 2px)'],
      ['width', 'calc(1foo)'],
    ];
    const rows = [...REFUSED, ...LEFT];
    const views = rows
      .map(([key], i) => `<view nativeID="r${i}" [style.${key}]="rows[${i}]"></view>`)
      .join('');
    const mod = await build(
      'math-refused',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-math-refused',
  imports: [View],
  template: '${views}',
})
export class MathRefused {
  readonly rows = ${JSON.stringify(rows.map(([, value]) => value))};
}
`,
    );
    const warnings: string[] = [];
    mock.method(console, 'warn', (message: string) => warnings.push(message));
    try {
      const { fabric } = await render(mod['MathRefused'] as Type<unknown>, { dev: true });
      const name = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      rows.forEach(([key, value], i) => {
        const refused = i < REFUSED.length;
        const expected = refused ? undefined : value;
        assert.equal(styleOf(fabric, `r${i}`, [key])[key], expected, `${key}: ${value}`);
        assert.equal(
          warnings.some((message) => message.includes(`${name(key)}: ${value},`)),
          refused,
          `the warning for ${key}: ${value}`,
        );
      });
    } finally {
      mock.restoreAll();
    }
  });

  it('drops a transform CSS refuses', async () => {
    const REFUSED = [
      'scale(calc(1px + 1px))',
      'scale(1em)',
      'rotate(calc(1 + 1))',
      'rotate(1em)',
      'rotate(calc(1px + 1px))',
      'translateX(calc(1 + 1))',
      'translateX(calc(1deg + 1deg))',
      'translateX(calc(1px + 2))',
      // Chrome reads this one, and the stylesheet refuses it: no form holds it.
      'translateX(calc(50% + 1px))',
      'translateX(calc(1px)',
      'translateX(1px ',
    ];
    const views = REFUSED.map(
      (_, i) => `<view nativeID="r${i}" [style.transform]="rows[${i}]"></view>`,
    ).join('');
    const mod = await build(
      'math-transform',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-math-transform',
  imports: [View],
  template: '${views}',
})
export class MathTransform {
  readonly rows = ${JSON.stringify(REFUSED)};
}
`,
    );
    const warnings: string[] = [];
    mock.method(console, 'warn', (message: string) => warnings.push(message));
    try {
      const { fabric } = await render(mod['MathTransform'] as Type<unknown>, { dev: true });
      REFUSED.forEach((value, i) => {
        assert.equal(styleOf(fabric, `r${i}`, ['transform'])['transform'], undefined, value);
      });
      const said = (value: string) => warnings.some((message) => message.includes(value));
      assert.ok(said('rotate(calc(1 + 1))'), warnings.join('\n'));
      assert.ok(said('translateX(calc(1px + 2))'), warnings.join('\n'));
      assert.ok(said('scale(calc(1px + 1px))'), warnings.join('\n'));
      assert.ok(said('translateX(calc(1deg + 1deg))'), warnings.join('\n'));
      assert.ok(!said('translateX(calc(50% + 1px))'), 'Chrome reads it: nothing to refuse');
      assert.ok(!said('scale(1em)'), 'not a math function');
    } finally {
      mock.restoreAll();
    }
  });

  it('follows a binding through each kind of value and takes the last one out', async () => {
    const mod = await build(
      'math-follows',
      `
import { Component, signal } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-math-follows',
  imports: [View],
  template: '<view nativeID="box" [style.width]="width()" [style.font-size]="size()" [style.opacity]="opacity()" [style.transform]="transform()"></view>',
})
export class MathFollows {
  readonly width = signal<string | null>('calc(1em + 2px)');
  readonly size = signal<string | null>('calc(8px * 2)');
  readonly opacity = signal<string | null>('calc(1 / 2)');
  readonly transform = signal<string | null>('translateX(calc(1em + 2px))');
}
`,
    );
    type Bound = { set(value: string | null): void };
    const { fabric, instance } = await render(
      mod['MathFollows'] as Type<Record<'width' | 'size' | 'opacity' | 'transform', Bound>>,
    );
    const keys = ['width', 'fontSize', 'opacity', 'transform'];
    assert.deepEqual(styleOf(fabric, 'box', keys), {
      width: 18,
      fontSize: 16,
      opacity: 0.5,
      transform: [{ translateX: 18 }],
    });

    instance.size.set('calc(10px * 2)');
    await settle();
    assert.equal(styleOf(fabric, 'box', ['width'])['width'], 22, 'follows the font size');
    assert.deepEqual(styleOf(fabric, 'box', ['transform'])['transform'], [{ translateX: 22 }]);

    instance.width.set('calc(1px + 1px)');
    instance.transform.set('translateX(calc(1px + 1px))');
    await settle();
    assert.equal(styleOf(fabric, 'box', ['width'])['width'], 2, 'an em length gives way');
    assert.deepEqual(styleOf(fabric, 'box', ['transform'])['transform'], [{ translateX: 2 }]);

    instance.width.set('calc(1em + 1px)');
    instance.transform.set('translateX(calc(1em + 1px))');
    await settle();
    assert.equal(styleOf(fabric, 'box', ['width'])['width'], 21, 'and comes back');
    assert.deepEqual(styleOf(fabric, 'box', ['transform'])['transform'], [{ translateX: 21 }]);

    instance.width.set(null);
    instance.opacity.set(null);
    instance.transform.set(null);
    await settle();
    assert.deepEqual(styleOf(fabric, 'box', ['width', 'opacity', 'transform']), {
      width: undefined,
      opacity: undefined,
      transform: undefined,
    });
  });

  it('follows the viewport, in a length and in a transform', async () => {
    const { fabric, componentRef } = await renderEach([
      'width: calc(100vw - 10px)',
      'transform: translateX(calc(1vw + 1px))',
    ]);
    assert.equal(styleOf(fabric, 'bound0', ['width'])['width'], 390);
    componentRef.injector
      .get(Engine)
      .updateConditions({ width: 1000, height: 500, colorScheme: 'light' });
    await settle();
    assert.equal(styleOf(fabric, 'bound0', ['width'])['width'], 990);
    assert.deepEqual(styleOf(fabric, 'bound1', ['transform'])['transform'], [{ translateX: 11 }]);
    assert.deepEqual(
      styleOf(fabric, 'attribute1', ['transform']),
      styleOf(fabric, 'sheet1', ['transform']),
    );
  });

  it('does not overflow the stack on brackets nested without end', async () => {
    const deep = `${'calc('.repeat(20000)}1px${')'.repeat(20000)}`;
    const mod = await build(
      'math-deep',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-math-deep',
  imports: [View],
  template: '<view nativeID="box" [style.width]="width" [style.transform]="transform"></view>',
})
export class MathDeep {
  readonly width = '${deep}';
  readonly transform = 'translateX(${deep})';
}
`,
    );
    const { fabric } = await render(mod['MathDeep'] as Type<unknown>);
    assert.equal(styleOf(fabric, 'box', ['width'])['width'], deep);
    assert.equal(styleOf(fabric, 'box', ['transform'])['transform'], undefined);
  });
});
