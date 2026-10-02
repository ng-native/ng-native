/**
 * A release build empties the `styles` Angular compiles into a component definition, and only
 * that property: an input whose class field is called `styles` sits in the same definition, and a
 * template's text can read like the property. Both are the component's, and both have to survive.
 *
 * The app's components go through the compiler (`fixtures/styles-input.ts`). A library's arrive as
 * ng-packagr writes them and go through the linker: `fixtures/ng-packagr/acme-fixture.mjs` is
 * ng-packagr 22.2.4's FESM build of the same three components, and `acme-fixture.min.mjs` is that
 * file through `esbuild --minify --charset=utf8`, each kept byte for byte.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Type } from '@angular/core';
import { cleanup, render, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture, compileToCode } from './compile.ts';

const require = createRequire(import.meta.url);
const { transformAngular } = require('@ng-native/metro/angular-transform.cjs') as {
  transformAngular: (
    src: string,
    filename: string,
    options?: { dev?: boolean; platform?: string; libraryStyles?: string[] },
  ) => { code: string };
};

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(here, 'fixtures', name);

after(cleanup);

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

/** Every piece of text the commit drew, in order. */
const texts = (nodes: FakeFabricNode[]) =>
  flatten(nodes)
    .filter((node) => node.viewName === 'RawText')
    .map((node) => node.props['text']);

describe("a release build of the app's own components", () => {
  it('empties the compiled styles and nothing else', async () => {
    const code = compileToCode(fixture('styles-input.ts')).code;
    assert.doesNotMatch(code, /_nghost-%COMP%/, 'the compiled CSS is gone');

    const mod = await compileFixture(fixture('styles-input.ts'));
    const { fabric } = await render(mod['StylesInput'] as Type<unknown>);
    assert.deepEqual(texts(fabric.committed), ['bound', 'true', 'styles: [ "kept" ]']);
    assert.deepEqual(
      flatten(fabric.committed)
        .map((node) => node.props['paddingTop'])
        .filter((padding) => padding !== undefined),
      [1, 2, 3],
      'each component still has its sheet',
    );
  });
});

describe("a release build of a library's components", () => {
  const scratch = mkdtempSync(path.join(here, '.release-styles-'));
  after(() => rmSync(scratch, { recursive: true, force: true }));

  /** The library's file linked as a release build links it, loaded as the app would load it. */
  async function linked(name: string, libraryStyles?: string[]) {
    const file = `/app/node_modules/@acme/fixture/fesm2022/${name}`;
    const { code } = transformAngular(readFileSync(fixture(`ng-packagr/${name}`), 'utf8'), file, {
      dev: false,
      platform: 'ios',
      libraryStyles,
    });
    assert.doesNotMatch(code, /_nghost-%COMP%/, 'the shimmed CSS is gone');
    // A file of its own per build: a module is loaded once per URL.
    const out = path.join(scratch, `${libraryStyles ? 'opted-in' : 'release'}-${name}`);
    writeFileSync(out, code);
    return import(pathToFileURL(out).href) as Promise<Record<string, Type<unknown>>>;
  }

  it('keeps an aliased input called styles', async () => {
    const { AliasedStyles } = await linked('acme-fixture.mjs');
    const { fabric } = await render(AliasedStyles!, { inputs: { customStyles: 'bound' } });
    assert.deepEqual(texts(fabric.committed), ['bound']);
  });

  it('keeps an input called styles with a transform', async () => {
    const { TransformedStyles } = await linked('acme-fixture.mjs');
    const { fabric } = await render(TransformedStyles!, { inputs: { styles: '' } });
    assert.deepEqual(texts(fabric.committed), ['true'], 'booleanAttribute ran');
  });

  it('keeps template text that reads like the styles property', async () => {
    const { StylesInText } = await linked('acme-fixture.mjs');
    const { fabric } = await render(StylesInText!);
    assert.deepEqual(texts(fabric.committed), ['styles: [ "kept" ] and type: Nope, here']);
  });

  it('compiles the sheet of each component when the library is opted in', async () => {
    const mod = await linked('acme-fixture.mjs', ['@acme/fixture']);
    const paddings = [];
    for (const [name, inputs] of [
      ['AliasedStyles', { customStyles: 'bound' }],
      ['TransformedStyles', { styles: '' }],
      ['StylesInText', {}],
    ] as const) {
      const { fabric } = await render(mod[name]!, { inputs });
      paddings.push(
        ...flatten(fabric.committed)
          .map((node) => node.props['paddingTop'])
          .filter((padding) => padding !== undefined),
      );
      assert.ok(texts(fabric.committed).length, `${name} drew its text`);
    }
    assert.deepEqual(paddings, [1, 2, 3]);
  });

  // Minified, the linker's own output does not load (its template functions name `i0` where the
  // file's namespace is `t`), so this reads what the transform wrote rather than running it.
  it('reads a minified library as it reads a formatted one', () => {
    const file = '/app/node_modules/@acme/fixture/fesm2022/acme-fixture.min.mjs';
    const src = readFileSync(fixture('ng-packagr/acme-fixture.min.mjs'), 'utf8');
    const release = transformAngular(src, file, { dev: false, platform: 'ios' }).code;
    assert.match(release, /inputs: \{ styles: \[0, "customStyles", ?"styles"\] \}/);

    const { code } = transformAngular(src, file, {
      dev: false,
      platform: 'ios',
      libraryStyles: ['@acme/fixture'],
    });
    const paddings = [...code.matchAll(/"paddingTop":(\d+)/g)].map((match) => Number(match[1]));
    assert.deepEqual(paddings, [1, 2, 3], 'each component got its own sheet');
  });
});
