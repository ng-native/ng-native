/**
 * What the Angular transform refuses and what it lets through: its two guards against a build
 * that compiles and shows nothing, on code they have no business stopping, and the two values a
 * stylesheet can hold that must not half arrive, a shorthand native takes only part of and a
 * font's url that is not a file.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const transformer = require('@ng-native/metro/transformer.cjs') as {
  transform(params: object): unknown;
};
const { transformAngular } = require('@ng-native/metro/angular-transform.cjs') as {
  transformAngular(src: string, filename: string, options?: object): { code: string };
};

const scratch = mkdtempSync(path.join(realpathSync(tmpdir()), 'metro-transform-guards-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A file through the Metro babel transformer, as a bundle would send it. */
const bundle = (name: string, src: string) =>
  transformer.transform({
    filename: path.join(scratch, name),
    src,
    options: { dev: false, platform: 'ios', projectRoot: scratch },
    plugins: [],
  });

/** What the build warns while `run` transforms, and what it returns. */
function warned<T>(run: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: string) => void warnings.push(String(message));
  try {
    return { result: run(), warnings };
  } finally {
    console.warn = original;
  }
}

const component = (decorator: string, body = '') =>
  `import { Component } from '@angular/core';\n` +
  `@Component({ selector: 'x-a', ${decorator} })\nexport class A { ${body} }\n`;

/** The sheet a component's styles compile to, as the source the transform emits. */
function sheetOf(styles: string): { sheet: string; warnings: string[] } {
  const src = component(`template: '<view class="a"></view>', styles: \`${styles}\``);
  const { result, warnings } = warned(() =>
    transformAngular(src, path.join(scratch, 'a.ts'), { dev: false, platform: 'ios' }),
  );
  return { sheet: result.code.slice(result.code.indexOf('ɵnativeStyles')), warnings };
}

describe('the empty-template guard', () => {
  it('builds a component whose template is only a comment', () => {
    // A placeholder component. Angular renders nothing for it, which is what was written.
    assert.doesNotThrow(() => bundle('todo.ts', component(`template: '<!-- todo -->'`)));
  });
});

describe('a font face url', () => {
  // A url with no leading ./ is left out: tailwind-metro.test.ts pins it as a package's file.
  it('requires the file a url with a query names', () => {
    const { sheet } = sheetOf("@font-face { font-family: Inter; src: url('./Inter.ttf?v=2') }");
    assert.match(sheet, /require\("\.\/Inter\.ttf"\)/);
  });

  it('refuses a remote url rather than requiring it', () => {
    const run = () =>
      sheetOf("@font-face { font-family: Inter; src: url('https://fonts.test/Inter.ttf') }");
    const { sheet, warnings } = run();
    assert.doesNotMatch(sheet, /require\("https:/);
    assert.match(warnings.join('\n'), /Inter.*naming a file in the app/);
  });
});

describe('a shorthand with one value native cannot take', () => {
  it('drops the whole declaration, as its warning says, not all but its first side', () => {
    // A `calc()` of a share and points is a value the engine works out; `anchor-size()` is not.
    const { sheet, warnings } = sheetOf('.a { padding: 8px anchor-size(width) }');
    assert.match(warnings.join('\n'), /dropped 'padding'/);
    assert.doesNotMatch(sheet, /paddingTop/, 'no side of a dropped shorthand is applied');
  });

  it('leaves no unresolved marker in the declarations of a dropped inset', () => {
    const { sheet, warnings } = sheetOf('.a { inset: 0 10vw anchor(top) }');
    assert.match(warnings.join('\n'), /dropped 'inset'/);
    assert.doesNotMatch(sheet, /"declarations":\{[^}]*__defer/);
    assert.doesNotMatch(sheet, /"top":0/);
  });
});
