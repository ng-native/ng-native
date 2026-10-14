/**
 * An icon set is one module holding every icon in the set - `@ng-icons/lucide` is 872 KB of
 * 1,991 SVG strings - and Metro keeps a module whole, so an app that imported three icons shipped
 * all of them: about a quarter of the canary's release bundle. The transformer replaces a named
 * import from a set with the strings it names, so the set's module never enters the graph.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const { inlineIcons } = require('@ng-native/metro/inline-icons.cjs') as {
  inlineIcons(src: string, filename: string): string;
};

/** A file in this package, so the sets resolve as they would from an app's own source. */
const here = fileURLToPath(new URL('./app.ts', import.meta.url));

describe('inlining icons from a set', () => {
  it('replaces a named import with the SVG strings it names, on the same line', () => {
    const src =
      "import { lucideCompass, lucideTarget } from '@ng-icons/lucide';\nexport const a = 1;\n";
    const out = inlineIcons(src, here);
    assert.doesNotMatch(out, /from '@ng-icons\/lucide'/);
    assert.match(out, /^const lucideCompass = `<svg[^`]*<\/svg>`, lucideTarget = `<svg/);
    assert.equal(out.split('\n').length, src.split('\n').length, 'line numbers are kept');
  });

  it('leaves an import written inside a template literal, a code sample an app shows', () => {
    const src =
      'export const SAMPLE = `\n' +
      "import { lucideCompass } from '@ng-icons/lucide';\n" +
      '`;\n' +
      "import { lucideTarget } from '@ng-icons/lucide';\n";
    const out = inlineIcons(src, here);
    assert.match(out, /^import \{ lucideCompass \} from '@ng-icons\/lucide';$/m, 'the sample');
    assert.match(out, /^const lucideTarget = `<svg/m, 'and the import after it is still inlined');
  });

  it('keeps the lines of an import written over several, as Prettier wraps a long one', () => {
    const src =
      "import {\n  lucideCompass,\n  lucideTarget,\n} from '@ng-icons/lucide';\nexport const a = 1;\n";
    const out = inlineIcons(src, here);
    assert.doesNotMatch(out, /from '@ng-icons\/lucide'/);
    assert.equal(out.split('\n').length, src.split('\n').length, 'line numbers are kept');
    assert.equal(out.split('\n')[4], 'export const a = 1;');
  });

  it('reports a template error after a wrapped import at the line it is on', () => {
    const transformer = require('@ng-native/metro/transformer.cjs');
    const src = [
      "import { Component } from '@angular/core';",
      'import {',
      '  lucideCompass,',
      '  lucideTarget,',
      "} from '@ng-icons/lucide';",
      '',
      '@Component({',
      "  selector: 'x-a',",
      "  template: '<view>@if (on() {<text>x</text>}</view>',",
      '})',
      'export class A { on = () => true; icons = [lucideCompass, lucideTarget]; }',
      '',
    ].join('\n');
    assert.throws(
      () => transformer.transform({ filename: here, src, options: { dev: false }, plugins: [] }),
      (error: { loc?: { line: number } }) => error.loc?.line === 9,
    );
  });

  it('keeps an as rename, and reads a set from a subpath', () => {
    const src = "import { heroBolt as bolt } from '@ng-icons/heroicons/outline';\n";
    assert.match(inlineIcons(src, here), /^const bolt = `<svg/);
  });

  it('leaves the import alone when a name is not in the set, so the error is the real one', () => {
    const src = "import { lucideCompass, lucideNoSuchIcon } from '@ng-icons/lucide';\n";
    assert.equal(inlineIcons(src, here), src);
  });

  it('leaves a namespace import, a type import and @ng-icons/core alone', () => {
    for (const src of [
      "import * as lucide from '@ng-icons/lucide';\n",
      "import type { IconType } from '@ng-icons/core';\n",
      "import { provideIcons } from '@ng-icons/core';\n",
    ]) {
      assert.equal(inlineIcons(src, here), src);
    }
  });

  it('leaves a type import from a set alone, since it has no value to inline', () => {
    const src = "import type { lucideCompass } from '@ng-icons/lucide';\n";
    assert.equal(inlineIcons(src, here), src);
  });

  it('reads an icon a set exports under another name', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'icon-set-'));
    const set = path.join(dir, 'node_modules', '@ng-icons', 'fake');
    mkdirSync(set, { recursive: true });
    writeFileSync(path.join(set, 'package.json'), '{"name":"@ng-icons/fake","main":"index.mjs"}');
    writeFileSync(
      path.join(set, 'index.mjs'),
      'const a = `<svg>fake</svg>`;\nexport { a as fakeStar };\n',
    );
    try {
      const src = "import { fakeStar } from '@ng-icons/fake';\n";
      assert.equal(
        inlineIcons(src, path.join(dir, 'app.ts')),
        'const fakeStar = `<svg>fake</svg>`;\n',
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('does nothing to a file that imports no icons', () => {
    const src = "import { Component } from '@angular/core';\n";
    assert.equal(inlineIcons(src, here), src);
  });
});

it('is what the Metro transformer does to every file, so the set never reaches the graph', () => {
  const transformer = require('@ng-native/metro/transformer.cjs') as {
    transform(params: {
      filename: string;
      src: string;
      options: { dev: boolean };
      plugins: unknown[];
    }): { ast: object };
  };
  const generate = (require('@babel/generator') as { default: Function }).default;
  const src =
    "import { lucideCompass } from '@ng-icons/lucide';\nexport const icon = lucideCompass;\n";
  const { ast } = transformer.transform({
    filename: here,
    src,
    options: { dev: false },
    plugins: [],
  });
  const { code } = generate(ast) as { code: string };
  assert.doesNotMatch(code, /@ng-icons\/lucide/);
  assert.match(code, /<svg/);
});
