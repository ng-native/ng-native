/**
 * What Angular hands the renderer for a bound style that a browser reads without trouble. A value
 * ending in `!important` arrives with that taken off and the space before it left on, `'10px '`,
 * and an empty one arrives as `''` through `setStyle`, where a browser takes the declaration out.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, type FakeFabricNode } from '@ng-native/testing';
import { compileSource } from './compile.ts';

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

async function build(name: string, source: string): Promise<Record<string, unknown>> {
  const file = path.join(import.meta.dirname, `bound-style-value-${name}.fixture.ts`);
  return compileSource(source, file, file.replace(/\.ts$/, '.generated.ts'));
}

/** The style a view with `nativeID` `id` commits, a stylesheet's flattened in with its own. */
function styleOf(fabric: { committed: readonly FakeFabricNode[] }, id: string) {
  const node = flatten(fabric.committed).find((one) => one.props['nativeID'] === id)!;
  const { style, ...props } = node.props;
  return { ...props, ...(style as Record<string, unknown> | undefined) };
}

describe('a bound style value', () => {
  afterEach(() => cleanup());

  it('is read without the !important it ends in', async () => {
    const mod = await build(
      'important',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';

@Component({
  selector: 'x-important',
  imports: [View],
  template: \`
    <view nativeID="a" [style.width]="'10px !important'" [style.margin-top]="'4 !important'"
      [style.opacity]="'0.5 !important'" [style.padding]="'2px 3px !important'" />
    <view nativeID="b" [style.--w]="'12px !important'" [style.height]="'var(--w) !important'" />
  \`,
})
export class Important {}
`,
    );
    const { fabric } = await render(mod['Important'] as Type<unknown>);
    const a = styleOf(fabric, 'a');
    assert.deepEqual(
      [a['width'], a['marginTop'], a['opacity']],
      [10, 4, 0.5],
      'a length, a number and a fraction',
    );
    assert.deepEqual(
      [a['paddingTop'], a['paddingRight'], a['paddingBottom'], a['paddingLeft']],
      [2, 3, 2, 3],
      'and a shorthand',
    );
    assert.equal(styleOf(fabric, 'b')['height'], 12, 'and a token, and a var() of it');
  });

  it('that is empty takes the declaration out, so a class rule applies again', async () => {
    const mod = await build(
      'empty',
      `
import { Component, signal } from '@angular/core';
import { View } from '../components/src/view.ts';

@Component({
  selector: 'x-empty',
  imports: [View],
  styles: ['.box { width: 50px; height: 60px; --h: 70px }'],
  template: \`
    <view nativeID="a" class="box" [style.width]="width()" [style]="{ height: height() }" />
    <view nativeID="b" class="box" [style.--h]="token()" [style.min-height]="'var(--h)'" />
    <view nativeID="c" [style.width]="width()" />
  \`,
})
export class Empty {
  readonly width = signal('10px');
  readonly height = signal('20px');
  readonly token = signal('30px');
}
`,
    );
    const app = await render(mod['Empty'] as Type<unknown>);
    const set = (name: string, value: string) =>
      (app.instance as Record<string, { set(value: string): void }>)[name]!.set(value);
    assert.deepEqual(
      [styleOf(app.fabric, 'a')['width'], styleOf(app.fabric, 'a')['height']],
      [10, 20],
    );
    assert.equal(styleOf(app.fabric, 'b')['minHeight'], 30);

    set('width', '');
    set('height', '');
    set('token', '');
    await app.detectChanges();
    const a = styleOf(app.fabric, 'a');
    assert.deepEqual([a['width'], a['height']], [50, 60], 'by a [style.x] and a [style] object');
    assert.equal(styleOf(app.fabric, 'b')['minHeight'], 70, "and a token, the class's again");
    assert.equal(
      styleOf(app.fabric, 'c')['width'] ?? null,
      null,
      'and none left where no rule sets one',
    );

    set('width', '15px');
    await app.detectChanges();
    assert.equal(styleOf(app.fabric, 'a')['width'], 15, 'and set again after');
  });

  it('that is blank keeps a token there, blank, so the class token under it stays hidden', async () => {
    const mod = await build(
      'blank-token',
      `
import { Component, signal } from '@angular/core';
import { View } from '../components/src/view.ts';

@Component({
  selector: 'x-blank-token',
  imports: [View],
  styles: ['.box { --h: 70px }'],
  template: \`<view nativeID="a" class="box" [style.--h]="token()" [style.min-height]="'var(--h)'" />\`,
})
export class BlankToken {
  readonly token = signal('30px');
}
`,
    );
    const app = await render(mod['BlankToken'] as Type<unknown>);
    const set = (value: string) =>
      (app.instance as { token: { set(value: string): void } }).token.set(value);
    assert.equal(styleOf(app.fabric, 'a')['minHeight'], 30);

    set('  ');
    await app.detectChanges();
    assert.equal(
      styleOf(app.fabric, 'a')['minHeight'] ?? null,
      null,
      'nothing to read, where Chrome keeps --h: ; and computes no min-height',
    );

    set('');
    await app.detectChanges();
    assert.equal(styleOf(app.fabric, 'a')['minHeight'], 70, 'an empty one takes it out');
  });

  it('that is blank is dropped with a warning, and the one before it kept, as Chrome does', async () => {
    const mod = await build(
      'blank',
      `
import { Component, signal } from '@angular/core';
import { View } from '../components/src/view.ts';

@Component({
  selector: 'x-blank',
  imports: [View],
  template: \`<view nativeID="a" [style.width]="width()" />\`,
})
export class Blank {
  readonly width = signal('10px');
}
`,
    );
    // Development, where a dropped declaration is said.
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    const warned: string[] = [];
    const warn = console.warn;
    console.warn = (message: string) => warned.push(message);
    let app: Awaited<ReturnType<typeof render>>;
    try {
      app = await render(mod['Blank'] as Type<unknown>);
      (app.instance as { width: { set(value: string): void } }).width.set('  ');
      await app.detectChanges();
    } finally {
      console.warn = warn;
      delete (globalThis as { __DEV__?: boolean }).__DEV__;
    }
    assert.equal(styleOf(app.fabric, 'a')['width'], 10);
    assert.equal(warned.length, 1);
    assert.match(
      warned[0]!,
      /width: {3}, in a style on <view>, is no value width takes: it is blank/,
    );
  });
  it('that is blank still lets a shorthand read the var() fallback around it', async () => {
    const mod = await build(
      'blank-shorthand',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';

@Component({
  selector: 'x-blank-shorthand',
  imports: [View],
  styles: ['.b { border: 1px solid var(--extra,); }', '.sb { --extra: ; }'],
  template: \`
    <view nativeID="a" class="b" [style.--extra]="'  '" />
    <view nativeID="b" class="b sb" />
  \`,
})
export class BlankShorthand {}
`,
    );
    const { fabric } = await render(mod['BlankShorthand'] as Type<unknown>);
    const sheet = styleOf(fabric, 'b');
    assert.equal(sheet['borderTopWidth'], 1, 'a blank set in a stylesheet keeps the border');
    const bound = styleOf(fabric, 'a');
    assert.deepEqual(
      [bound['borderTopWidth'], bound['borderStyle']],
      [sheet['borderTopWidth'], sheet['borderStyle']],
      'and a bound one keeps it alike',
    );
  });

  // A static `style="--h: ;"` never gets here: Angular's compiler leaves the empty declaration out.
  it('that is blank in a style attribute hides the class token, as a bound one does', async () => {
    const mod = await build(
      'blank-attribute',
      `
import { Component } from '@angular/core';
import { View } from '../components/src/view.ts';

@Component({
  selector: 'x-blank-attribute',
  imports: [View],
  styles: ['.outer { --h: 70px }'],
  template: \`
    <view class="outer">
      <view nativeID="a" [attr.style]="'--h: ;'" [style.min-height]="'var(--h)'" />
      <view nativeID="c" [attr.style]="'--h:;'" [style.min-height]="'var(--h)'" />
      <view nativeID="b" [style.--h]="'  '" [style.min-height]="'var(--h)'" />
    </view>
  \`,
})
export class BlankAttribute {}
`,
    );
    const { fabric } = await render(mod['BlankAttribute'] as Type<unknown>);
    assert.equal(styleOf(fabric, 'b')['minHeight'] ?? null, null, 'bound');
    assert.equal(
      styleOf(fabric, 'a')['minHeight'] ?? null,
      null,
      'the attribute, as Chrome leaves it unset',
    );
    assert.equal(
      styleOf(fabric, 'c')['minHeight'] ?? null,
      null,
      'and with no space after the colon',
    );
  });
});
