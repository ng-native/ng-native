/**
 * A component's compiled sheet is on its class by the time the class is defined, so
 * `styleSheetOf()` called at the top of the module that declares it reads the sheet. A library that
 * exports its global styles as a value (`export const themeStyles = styleSheetOf(ThemeStyles)`)
 * hands `mount()` and `loadFonts()` that value, and a null there is a silent "no global sheet".
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compileSource } from './compile.ts';

const require = createRequire(import.meta.url);
const { transformAngular } = require('@ng-native/metro/angular-transform.cjs') as {
  transformAngular(src: string, filename: string, options?: object): { code: string };
};

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const HEAD = `import { Component } from '@angular/core';
import { styleSheetOf } from '@ng-native/fabric';
`;

const SOURCES: Record<string, string> = {
  'a plain class': `${HEAD}
@Component({ selector: 'x-a', template: '', styles: ['a { color: red }'] })
class A {}
export const read = styleSheetOf(A);
`,
  'an exported class': `${HEAD}
@Component({ selector: 'x-a', template: '', styles: ['a { color: red }'] })
export class A {}
export const read = styleSheetOf(A);
`,
  'a default export': `${HEAD}
@Component({ selector: 'x-a', template: '', styles: ['a { color: red }'] })
export default class A {}
export const read = styleSheetOf(A);
`,
  'the second of two components': `${HEAD}
@Component({ selector: 'x-b', template: '', styles: ['b { color: blue }'] })
class B {}
@Component({ selector: 'x-a', template: '', styles: ['a { color: red }'] })
class A {}
export const read = styleSheetOf(A);
export const other = styleSheetOf(B);
`,
};

describe('a sheet from a stylesheet file, read at module scope', () => {
  for (const dev of [false, true]) {
    it(`is there${dev ? ' in a dev build' : ''}`, async () => {
      const name = `module-scope-urls-${dev ? 'dev' : 'release'}`;
      const source = `${HEAD}
@Component({ selector: 'x-t', template: '', styleUrls: ['./module-scope-tokens.css'] })
class ThemeStyles {}
export const read = styleSheetOf(ThemeStyles);
`;
      const mod = await compileSource(
        source,
        fixture(`${name}.ts`),
        fixture(`${name}.generated.ts`),
        {
          dev,
        },
      );
      assert.ok(mod['read'], 'the sheet is not null');
      assert.match(JSON.stringify(mod['read']), /--gap/);
    });
  }
});

describe('where the sheet is written', () => {
  it('is once per component, on its definition, and not again after the module', () => {
    const { code } = transformAngular(SOURCES['a plain class']!, '/tmp/once.ts', {});
    assert.equal(code.split('ɵnativeStyles').length - 1, 1);
    assert.ok(code.indexOf('ɵnativeStyles') < code.indexOf('export const read'));
  });
});

describe('a sheet read at module scope', () => {
  for (const dev of [false, true]) {
    for (const [shape, source] of Object.entries(SOURCES)) {
      it(`is there for ${shape}${dev ? ' in a dev build' : ''}`, async () => {
        const name = `module-scope-${Object.keys(SOURCES).indexOf(shape)}-${dev ? 'dev' : 'release'}`;
        const mod = await compileSource(
          source,
          fixture(`${name}.ts`),
          fixture(`${name}.generated.ts`),
          {
            dev,
          },
        );
        const sheet = mod['read'] as { rules: { declarations: Record<string, string> }[] } | null;
        assert.ok(sheet, 'the sheet is not null');
        assert.deepEqual(sheet.rules[0]!.declarations, { color: 'rgb(255, 0, 0)' });
        if (shape.startsWith('the second')) {
          const other = mod['other'] as typeof sheet;
          assert.deepEqual(other.rules[0]!.declarations, { color: 'rgb(0, 0, 255)' });
        }
      });
    }
  }
});
