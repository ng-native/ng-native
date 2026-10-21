/**
 * A multiline text input's `rows`: how many lines tall it is where nothing else says, as a
 * `<textarea rows="3">` is three lines of its line height in a browser. A native field is as
 * tall as its text, which with none typed is one line.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine, registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, compileCss, createFakeFabric, render, settle } from '@ng-native/testing';
import { compileSource } from './compile.ts';

function field(css: string, props: Record<string, unknown>, fontScale = 1) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css, 'app.css') as never,
    conditions: { width: 400, height: 800, colorScheme: 'light', fontScale },
  });
  const input = engine.createElement('text-input');
  for (const [key, value] of Object.entries(props)) engine.setProp(input, key, value);
  engine.appendChild(engine.root, input);
  const height = () => {
    engine.commit();
    return fabric.committed[0]!.props['height'] ?? null;
  };
  return { engine, input, height, fabric };
}

const LINES = 'text-input { line-height: 20px }';

describe('rows on a multiline text input', () => {
  it('is that many lines of its line height, with its padding and border', () => {
    assert.equal(field(LINES, { multiline: true, rows: 3 }).height(), 60);
    const padded = `${LINES} text-input { padding: 4px 0; border-width: 1px }`;
    // As written in a template, the attribute is text.
    assert.equal(field(padded, { multiline: true, rows: '3' }).height(), 70);
    // A content box's height is its lines alone: Yoga adds the padding and border itself.
    const content = `${padded} text-input { box-sizing: content-box }`;
    assert.equal(field(content, { multiline: true, rows: 3 }).height(), 60);
  });

  it('gives way to a height of its own, and is no height where `auto` is written', () => {
    const fixed = field(`${LINES} text-input { height: 44px }`, { multiline: true, rows: 3 });
    assert.equal(fixed.height(), 44);
    const auto = field(`${LINES} text-input { height: auto }`, { multiline: true, rows: 3 });
    assert.equal(auto.height(), 60);
  });

  it('is nothing on a field of one line, or with no line height to count in', () => {
    assert.equal(field(LINES, { rows: 3 }).height(), null);
    assert.equal(field('', { multiline: true, rows: 3 }).height(), null);
  });

  it('follows the rows changing, and going', () => {
    const area = field(LINES, { multiline: true, rows: 2 });
    assert.equal(area.height(), 40);
    area.engine.setProp(area.input, 'rows', 4);
    assert.equal(area.height(), 80);
    area.engine.setProp(area.input, 'rows', null);
    assert.equal(area.height(), null);
  });

  it('is not sent to native, which has no prop of that name', () => {
    const area = field(LINES, { multiline: true, rows: 3 });
    assert.equal(area.height(), 60);
    assert.equal('rows' in area.fabric.committed[0]!.props, false);
    // Android's field, under its own name.
    registerPlatformComponents('android');
    try {
      const android = field(LINES, { multiline: true, rows: 3 });
      assert.equal(android.height(), 60);
      assert.equal(android.fabric.committed[0]!.viewName, 'AndroidTextInput');
      assert.equal('rows' in android.fabric.committed[0]!.props, false);
    } finally {
      registerPlatformComponents('ios');
    }
    // Another view's own `rows` is its business, and goes through.
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const grid = engine.createElement('view');
    engine.setProp(grid, 'rows', 3);
    engine.appendChild(engine.root, grid);
    engine.commit();
    assert.equal(fabric.committed[0]!.props['rows'], 3);
  });

  it('counts its lines at the system text size, as the field draws them', () => {
    const padded = `${LINES} text-input { padding: 4px 0 }`;
    assert.equal(field(padded, { multiline: true, rows: 3 }, 1.5).height(), 98);
    // Not for a field that does not scale, nor past the most one scales by.
    const fixed = { multiline: true, rows: 3, allowFontScaling: false };
    assert.equal(field(padded, fixed, 1.5).height(), 68);
    const capped = { multiline: true, rows: 3, maxFontSizeMultiplier: 1.2 };
    assert.equal(field(padded, capped, 1.5).height(), 80);
  });
});

describe('rows on the text-input component', () => {
  afterEach(() => cleanup());

  const source = `
import { Component, signal } from '@angular/core';
import { TextInput } from '../components/src/text-input.ts';
@Component({
  selector: 'x-area',
  imports: [TextInput],
  template: \`
    <text-input testID="static" multiline rows="3" style="line-height: 20px; padding: 0" />
    <text-input testID="bound" multiline [rows]="rows()" style="line-height: 20px; padding: 0" />
  \`,
})
export class Area { readonly rows = signal<number | undefined>(2); }
`;

  it('sizes the field, says nothing of it in development, and keeps it from native', async () => {
    const file = path.join(import.meta.dirname, 'text-input-rows.fixture.ts');
    const mod = await compileSource(source, file, file.replace(/\.ts$/, '.generated.ts'));
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
    try {
      const { fabric, instance } = await render(
        mod['Area'] as Type<{ rows: { set(value: number | undefined): void } }>,
        { dev: true },
      );
      const byID = (id: string) =>
        fabric.committed[0]!.children.find((n) => n.props['testID'] === id)!;
      assert.equal(byID('static').props['height'], 60);
      assert.equal(byID('bound').props['height'], 40);
      instance.rows.set(4);
      await settle();
      assert.equal(byID('bound').props['height'], 80);
      instance.rows.set(undefined);
      await settle();
      assert.equal(byID('bound').props['height'], null);
      for (const id of ['static', 'bound']) assert.equal('rows' in byID(id).props, false, id);
      assert.deepEqual(
        warnings.filter((line) => line.includes('has no prop')),
        [],
      );
    } finally {
      console.warn = warn;
    }
  });
});
