/**
 * The Metro pipeline: the transform chain itself, not the renderer. Compiling, linking, external
 * resources, the empty-template guard, and source positions that survive the Angular stage.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { compileFixture, compileToCode } from './compile.ts';

const require = createRequire(import.meta.url);
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
/** A path as a regular expression that matches it literally. */
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What the build prints while `run` transforms, and what it returns. */
function warned<T>(run: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: string) => void warnings.push(message);
  try {
    return { result: run(), warnings };
  } finally {
    console.warn = original;
  }
}

/** Run a component that does not compile through the Metro transformer, as a bundle would. */
function transformBroken(name: string, src: string): unknown {
  const transformer = require('@ng-native/metro/transformer.cjs') as {
    transform(params: object): unknown;
  };
  return transformer.transform({
    filename: path.isAbsolute(name) ? name : fixture(name),
    src,
    options: { dev: true, projectRoot: process.cwd() },
    plugins: [],
  });
}

describe('the transform chain', () => {
  it('fails the build on a template that compiled to nothing', async () => {
    // The trap this exists for: a capitalized element name yields decls:0 with zero errors
    // and a valid-looking ɵcmp, i.e. a blank screen on a green build.
    await assert.rejects(
      () => compileFixture(fixture('capitalized.ts')),
      /compiled to nothing.*<View> is capitalized/s,
    );
  });

  it('compiles a method shorthand inside decorator metadata to a module that loads', async () => {
    // @oxc-angular/vite through 0.0.39 dropped the "function"/"async"/"get" keyword when it
    // re-emitted the shorthand, with no error: the module was not valid JavaScript.
    const module = await compileFixture(fixture('method-shorthand-in-metadata.ts'));
    assert.equal(typeof module['MethodShorthandInMetadata'], 'function');
  });

  it('fails the build on a template arrow function that reads its own parameter, which oxc-angular mis-compiles', () => {
    // @oxc-angular/vite (through 0.0.40) resolves an arrow's parameter against the component:
    // "(o) => !o" in a template compiles to "(o) => !ctx.o", which reads undefined at runtime.
    const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');
    const component = (handler: string) =>
      `import { Component, signal } from '@angular/core';
       @Component({ selector: 'x-toggle', template: '<pressable (press)="${handler}"></pressable>' })
       export class Toggle { open = signal(false); }`;

    assert.throws(
      () => transformAngular(component('open.update((o) => !o)'), '/x/toggle.ts'),
      /toggle\.ts: .*arrow function.*"o".*method/s,
    );
    // An arrow that reads only the component is compiled correctly, so it is left alone.
    assert.doesNotThrow(() =>
      transformAngular(component('open.update(() => !open())'), '/x/toggle.ts'),
    );
  });

  it('compiles a component sheet for the platform Metro is bundling', () => {
    // grayscale() is drawn on Android and ignored on iOS, so the same component keeps it for one
    // and drops it with a warning for the other; with no platform, as under a test, it has to
    // suit both.
    const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');
    const src = `import { Component } from '@angular/core';
       @Component({ selector: 'x-grey', template: '<view class="a"></view>',
         styles: '.a { opacity: 0.5; filter: grayscale(1) }' })
       export class Grey {}`;

    const android = warned(() => transformAngular(src, '/x/grey.ts', { platform: 'android' }));
    assert.match(android.result.code, /"grayscale":1/);
    assert.deepEqual(android.warnings, []);

    for (const options of [{ platform: 'ios' }, {}]) {
      const { result, warnings } = warned(() => transformAngular(src, '/x/grey.ts', options));
      const sheet = result.code.slice(result.code.indexOf('ɵnativeStyles'));
      assert.doesNotMatch(sheet, /grayscale/);
      assert.match(sheet, /"opacity":0.5/, 'the rest of the rule still applies');
      assert.equal(warnings.length, 1);
      assert.match(
        warnings[0]!,
        /grey\.ts:3 \(Grey\): dropped 'filter': filter: grayscale\(\) is not drawn on iOS/,
      );
    }
  });

  it("names a dropped declaration by the line of the file it is on, not of the component's joined CSS", () => {
    // A component's inline styles and its styleUrl sheets are compiled as one text, so a line of
    // that text has to be turned back into a line of the file it came from.
    const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');
    const dir = mkdtempSync(path.join(tmpdir(), 'css-lines-'));
    try {
      mkdirSync(path.join(dir, 'shared'));
      writeFileSync(
        path.join(dir, 'shared', 'lab.css'),
        '.btn {\n  color: red;\n}\n.bad {\n  float: left;\n}\n',
      );
      const component = (styles: string) =>
        [
          "import { Component } from '@angular/core';",
          '',
          '@Component({',
          "  selector: 'x-page',",
          '  template: \'<view class="a"></view>\',',
          "  styleUrl: '../shared/lab.css',",
          '  styles: `',
          '    .a {',
          styles,
          '    }',
          '  `,',
          '})',
          'export class Page {}',
        ].join('\n');
      mkdirSync(path.join(dir, 'page'));
      const file = path.join(dir, 'page', 'page.ts');

      // The inline sheet comes after the external one in the joined text, and its line is moved by
      // where the literal starts in the file. The line is the rule's: `.a {` is on line 8.
      const inline = warned(() => transformAngular(component('      visibility: hidden;'), file));
      assert.match(
        inline.warnings.join('\n'),
        new RegExp(`${escape(file)}:8 \\(Page\\): dropped 'visibility'`),
      );
      // The external sheet is named by its own file and line.
      const external = warned(() => transformAngular(component('      color: blue;'), file));
      const sheet = path.join(dir, 'shared', 'lab.css');
      assert.match(
        external.warnings.join('\n'),
        new RegExp(`${escape(sheet)}:4 \\(Page\\): dropped 'float'`),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("puts a component's inline styles after its styleUrl sheet, as Angular does, so they win", () => {
    // Angular compiles the styleUrl sheets first and the inline styles after them, so an inline
    // rule overrides a shared one of the same specificity. The cascade has to agree.
    const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');
    const dir = mkdtempSync(path.join(tmpdir(), 'css-order-'));
    try {
      writeFileSync(path.join(dir, 'shared.css'), '.a { color: red; }\n');
      const file = path.join(dir, 'page.ts');
      const source = [
        "import { Component } from '@angular/core';",
        '@Component({',
        "  selector: 'x-page',",
        '  template: \'<view class="a"></view>\',',
        "  styleUrl: './shared.css',",
        "  styles: '.a { color: blue; }',",
        '})',
        'export class Page {}',
      ].join('\n');
      const { code } = transformAngular(source, file);
      const sheet = code.slice(code.indexOf('ɵnativeStyles'));
      const red = sheet.indexOf('rgb(255, 0, 0)');
      const blue = sheet.indexOf('rgb(0, 0, 255)');
      assert.ok(red !== -1 && blue !== -1, sheet.slice(0, 400));
      assert.ok(blue > red, 'the inline rule is the later one');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves TypeScript syntax for the downstream preset to strip', () => {
    // Not a bug, but the reason the transformer is a chain: oxc-angular is not a TS stripper.
    const { code } = compileToCode(fixture('counter.ts'));
    assert.match(code, /signal<number\[\]>/, 'generics survive the Angular transform');
  });

  it('passes non-Angular sources through untouched', () => {
    const src = 'export const answer: number = 42;\n';
    const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');
    assert.equal(transformAngular(src, '/x/plain.ts').code, src);
  });

  it('compiles a service, which has no template to give it away', () => {
    // A file whose only decorator is `@Service` still has to reach the compiler. Miss it and the
    // class ships with its decorator intact, and Angular asks for a JIT compiler this project
    // does not bundle - at the moment the service is first injected, not at build time.
    const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');
    const { code } = transformAngular(
      `import {Service} from '@angular/core';
       export class Base {}
       @Service({factory: () => new Base()})
       export abstract class Thing extends Base {}`,
      '/x/thing.ts',
    );
    assert.match(code, /ɵɵdefineService/, 'the service was compiled');
    assert.doesNotMatch(code, /@Service\(/, 'and its decorator is gone');
  });

  it('links a partial-compiled package into full Ivy', () => {
    const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');
    const { transformAngularFileSync } = require('@oxc-angular/vite/api');

    // Every Angular library on npm ships like this; without the linker they fail at runtime.
    const partial = transformAngularFileSync(
      `import {Component} from '@angular/core';
       @Component({selector: 'x-lib', template: '<view><text>lib</text></view>'})
       export class Lib {}`,
      '/node_modules/some-lib/lib.mjs',
      { compilationMode: 'partial' },
    );
    assert.match(partial.code, /ɵɵngDeclareComponent/, 'fixture really is partial-compiled');

    const linked = transformAngular(partial.code, '/node_modules/some-lib/lib.mjs').code;
    assert.match(linked, /ɵɵdefineComponent/, 'linker expanded the declaration');
    assert.doesNotMatch(linked, /ɵɵngDeclareComponent/, 'no partial declaration left');
  });

  it("drops a linked library's component CSS from a release build, as it does the app's own", () => {
    // A library's styles are written for a browser and nothing on native reads them, so they were
    // only weight - and in a shape the app's own stripping did not look for.
    const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');
    const { transformAngularFileSync } = require('@oxc-angular/vite/api');
    const file = '/node_modules/some-lib/styled.mjs';
    const partial = transformAngularFileSync(
      `import {Component} from '@angular/core';
       @Component({selector: 'x-lib', template: '<text>lib</text>', styles: [':host { display: block; }']})
       export class Lib {}`,
      file,
      { compilationMode: 'partial' },
    ).code;

    const release = transformAngular(partial, file).code;
    assert.match(release, /ɵɵdefineComponent/);
    assert.doesNotMatch(release, /_nghost-%COMP%/, 'no shimmed CSS in the definition');

    const web = transformAngular(partial, file, { platform: 'web' }).code;
    assert.match(web, /_nghost-%COMP%/, 'a web build keeps it: a browser applies it there');
    assert.match(transformAngular(partial, file, { dev: true }).code, /_nghost-%COMP%/);
  });

  it('resolves an external templateUrl and reports it as a dependency', () => {
    const { code, dependencies } = compileToCode(fixture('external.ts'));

    assert.deepEqual(dependencies, ['./external.html'], 'reported for watch invalidation');
    assert.match(code, /decls:\s*[1-9]/, 'the external template actually compiled');
    assert.match(
      code,
      /^import "\.\/external\.html";/,
      'an import edge is emitted so Metro invalidates the component when the template changes',
    );
  });

  it('imports a templateUrl written without ./ as the file beside the component', () => {
    // Angular reads 'external.html' as relative to the component, as it does './external.html'.
    // Emitted as written, the import edge named a package called external.html, and Metro failed
    // the whole bundle with "Unable to resolve module".
    const { code } = compileToCode(fixture('external-bare-url.ts'));
    assert.match(code, /^import "\.\/external\.html";/);
  });

  it("carries the owning component's hot update in a template's own module, in dev", () => {
    // Metro only re-transforms the file that changed, so the update has to live here: the
    // component's module is still cached with the old template compiled into it.
    const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');
    const file = fixture('external-counter.html');
    const { code } = transformAngular(readFileSync(file, 'utf8'), file, { dev: true });

    assert.match(code, /external-counter\.ts@ExternalCounter/, 'found the component that uses it');
    assert.match(code, /ɵɵreplaceMetadata/, 'through the same swap an inline template takes');
    assert.match(code, /module\.hot\.accept\(\)/, 'and stops the update bubbling to a reload');
  });

  it("carries the owning component's compiled sheet in a stylesheet's own module, in dev", () => {
    const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');
    const file = fixture('external-counter.css');
    const { code } = transformAngular(readFileSync(file, 'utf8'), file, { dev: true });

    assert.match(code, /external-counter\.ts@ExternalCounter/);
    assert.match(code, /rgb\(1, 1, 1\)/, 'the sheet compiled from the new text');
  });

  it('finds the owning component when Metro names the file relative to the project', () => {
    // Metro's transformer is handed `pages/x.html`, not an absolute path, and the ids have to
    // match the ones the component's own module registers under the same relative name.
    const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');
    const file = path.relative(process.cwd(), fixture('external-counter.html'));
    const { code } = transformAngular(readFileSync(file, 'utf8'), file, { dev: true });
    const owner = path.join(path.dirname(file), 'external-counter.ts');
    assert.ok(
      code.includes(JSON.stringify(`${owner}@ExternalCounter`)),
      'found, under its own name',
    );
  });

  it('leaves an external resource an empty module in a release build', () => {
    const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');
    const file = fixture('external-counter.html');
    assert.equal(transformAngular(readFileSync(file, 'utf8'), file).code, '');
  });

  it("leaves a web build's external template an empty module, whatever its stylesheet holds", () => {
    // A DOM component's page is a web bundle. Its template's module carried the native hot update,
    // which compiles the component's stylesheet for native, so a rule only a browser has - the
    // point of a DOM component - failed the dev bundle.
    const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');
    const file = fixture('dom-external.html');
    const options = { dev: true, platform: 'web' };
    assert.equal(transformAngular(readFileSync(file, 'utf8'), file, options).code, '');
  });

  it('runs an externally-templated component end to end', async () => {
    const mod = await compileFixture(fixture('external.ts'));
    assert.ok(mod['External'], 'component compiled and loaded');
  });
});

describe('source positions', () => {
  /**
   * The whole chain, the way Metro runs it: our transformer hands the downstream one an AST, and
   * Metro builds its source map from the positions on it. Left alone those describe the compiled
   * output - in one of the canary's pages a line had moved 34 lines - so every stack trace, every
   * warning and every breakpoint would point somewhere else.
   */
  it('points a compiled line back at the line someone wrote', () => {
    const transformer = require('@ng-native/metro/transformer.cjs') as {
      transform(params: {
        filename: string;
        src: string;
        options: { dev: boolean };
        plugins: unknown[];
      }): { ast: object };
    };
    const generate = (require('@babel/generator') as { default: Function }).default;

    const filename = fixture('counter.ts');
    const src = readFileSync(filename, 'utf8');
    const marker = src.split('\n').findIndex((line) => line.includes('this.items.update')) + 1;
    assert.ok(marker > 0, 'the fixture still has the method this looks for');

    const { ast } = transformer.transform({ filename, src, options: { dev: true }, plugins: [] });
    const { code, map } = generate(
      ast,
      { sourceMaps: true, sourceFileName: filename },
      { [filename]: src },
    ) as { code: string; map: { mappings: string; sources: string[] } };

    const generatedLine =
      code.split('\n').findIndex((line) => line.includes('this.items.update')) + 1;
    assert.ok(generatedLine > 0, 'the method survived the compile');

    const { TraceMap, originalPositionFor } = require('@jridgewell/trace-mapping') as {
      TraceMap: new (map: object) => object;
      originalPositionFor(
        map: object,
        at: { line: number; column: number },
      ): { line: number | null };
    };
    const traced = new TraceMap(map);
    const column = code.split('\n')[generatedLine - 1]!.indexOf('this.items.update');
    const original = originalPositionFor(traced, { line: generatedLine, column });

    assert.equal(
      original.line,
      marker,
      'the map sends a reader to the source line, not to the compiled one',
    );
  });
});

describe('a file that does not compile', () => {
  it('reports a syntax error in a component at the line and column it is on', () => {
    // The Angular compiler parses the file first and reports "Unexpected token" with no position
    // at all, which left a reader to search the whole file for it.
    const transformer = require('@ng-native/metro/transformer.cjs') as {
      transform(params: object): unknown;
    };
    const src = [
      "import { Component } from '@angular/core';",
      '',
      "@Component({ selector: 'x-broken', template: '<text>x</text>' })",
      'export class Broken {',
      '  label = ;',
      '}',
      '',
    ].join('\n');

    assert.throws(
      () =>
        transformer.transform({
          filename: fixture('broken.ts'),
          src,
          options: { dev: true, projectRoot: process.cwd() },
          plugins: [],
        }),
      (error: Error & { loc?: { line: number; column: number } }) => {
        assert.deepEqual(
          { line: error.loc?.line, column: error.loc?.column },
          { line: 5, column: 10 },
        );
        // Nx forces colour on, and Babel's code frame is coloured when it is.
        const message = stripVTControlCharacters(error.message);
        assert.match(message, /broken\.ts: Unexpected token \(5:10\)/);
        assert.match(message, />\s*5 \|\s+label = ;/, 'with the line quoted');
        return true;
      },
    );
  });

  it('still reports an error in a template, which the TypeScript around it cannot show', () => {
    const src = [
      "import { Component } from '@angular/core';",
      "@Component({ selector: 'x-broken', template: '<text>{{ label( }}</text>' })",
      'export class Broken {}',
      '',
    ].join('\n');

    assert.throws(
      () => transformBroken('broken-template.ts', src),
      /broken-template\.ts: Missing expected \)/,
    );
  });
});

describe('a template error, which the compiler reports with no position', () => {
  // `@oxc-angular/vite` gives a template error empty `labels`, so all it said was the file. What
  // the message quotes is found in the template instead, and a line is claimed only when that
  // text is there once.
  type Located = Error & { loc?: { line: number; column: number } };
  const failure = (run: () => unknown): Located => {
    try {
      run();
    } catch (error) {
      return error as Located;
    }
    return assert.fail('the file compiled');
  };

  it('points at the expression in an inline template', () => {
    const src = [
      "import { Component } from '@angular/core';",
      "@Component({ selector: 'x-broken', template: '<text>{{ label( }}</text>' })",
      'export class Broken {}',
      '',
    ].join('\n');
    const column = src.split('\n')[1]!.indexOf('label(');

    const error = failure(() => transformBroken('broken-template.ts', src));

    assert.deepEqual(error.loc, { line: 2, column });
    const message = stripVTControlCharacters(error.message);
    assert.ok(
      message.includes(
        `broken-template.ts: Missing expected ) at the end of the expression [ label( ] (2:${column})`,
      ),
      message,
    );
    const frame = message.split('\n');
    const quoted = frame.findIndex((line) => /^>\s*2 \|/.test(line));
    assert.ok(frame[quoted]!.endsWith(src.split('\n')[1]!), 'the line is quoted');
    assert.equal(frame[quoted + 1]!.indexOf('^'), frame[quoted]!.indexOf('label('), 'under it');
  });

  it('frames the error with the lines around it', () => {
    const src = [
      "import { Component } from '@angular/core';",
      '// a line before',
      "@Component({ selector: 'x-broken', template: '<text>{{ label( }}</text>' })",
      'export class Broken {}',
      '',
    ].join('\n');
    const frame = stripVTControlCharacters(
      failure(() => transformBroken('broken-template.ts', src)).message,
    );
    assert.match(frame, /^ {2}1 \| import \{ Component \}/m, 'two lines before');
    assert.match(frame, /^ {2}4 \| export class Broken/m, 'and the lines after');
  });

  it('counts lines through a template written over several', () => {
    const src = [
      "import { Component } from '@angular/core';",
      '',
      '@Component({',
      "  selector: 'x-broken',",
      '  template: `',
      '    <view>',
      '      <text>title</text>',
      '    </view>',
      '    @if (ready) {',
      '      <text>ready</text>',
      '  `,',
      '})',
      'export class Broken {',
      '  ready = true;',
      '}',
      '',
    ].join('\n');

    const error = failure(() => transformBroken('broken-block.ts', src));

    assert.deepEqual(error.loc, { line: 9, column: 4 });
    const message = stripVTControlCharacters(error.message);
    assert.ok(message.includes('Unclosed block "@if" (9:4)'), message);
    assert.match(message, />\s*9 \|\s+@if \(ready\) \{/);
  });

  it('gives no line when what the message quotes is in the template more than once', () => {
    const src = [
      "import { Component } from '@angular/core';",
      '@Component({',
      "  selector: 'x-broken',",
      "  template: '@if (a) { <text>a</text> } @if (b) { <text>b</text>',",
      '})',
      'export class Broken {',
      '  a = true;',
      '  b = true;',
      '}',
      '',
    ].join('\n');

    const error = failure(() => transformBroken('broken-twice.ts', src));

    assert.equal(error.loc, undefined, 'no position is claimed');
    assert.ok(
      error.message.endsWith(
        'broken-twice.ts: Unclosed block "@if"\n' +
          'This is in Broken\'s template, where "@if" appears 2 times, so the line cannot be told.',
      ),
      error.message,
    );
  });

  it('points into an external template by its own file, line and column', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ng-native-template-error-'));
    try {
      const component = path.join(directory, 'broken-external.ts');
      const template = path.join(directory, 'broken-external.html');
      const html = ['<view>', '  <text>ok</text>', '  <text>{{ total( }}</text>', '</view>', ''];
      writeFileSync(template, html.join('\n'));
      const src = [
        "import { Component } from '@angular/core';",
        "@Component({ selector: 'x-broken', templateUrl: './broken-external.html' })",
        'export class Broken {}',
        '',
      ].join('\n');
      writeFileSync(component, src);

      const error = failure(() => transformBroken(component, src));

      // A `loc` would be read as a line of the component's file, which is the wrong file.
      assert.equal(error.loc, undefined);
      const message = stripVTControlCharacters(error.message);
      const column = html[2]!.indexOf('total(') + 1;
      assert.ok(
        message.includes(
          `Missing expected ) at the end of the expression [ total( ]\n  at ${template}:3:${column}`,
        ),
        message,
      );
      assert.match(message, />\s*3 \|\s+<text>\{\{ total\( \}\}<\/text>/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('a template the compiler cuts short without an error', () => {
  // `@oxc-angular/vite` (0.0.40) reports no error for a block whose parameters never close: it
  // compiles everything before it and drops the rest. The screen showed only what came before the
  // block, in hot reload, under Vitest and in a production export. It reports a @let with no
  // semicolon itself.
  type Located = Error & { loc?: { line: number; column: number } };
  const failure = (run: () => unknown): Located => {
    try {
      run();
    } catch (error) {
      return error as Located;
    }
    return assert.fail('the file compiled');
  };
  const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');

  it('fails the build on a block whose parameters never close, at the block', () => {
    const src = [
      "import { Component } from '@angular/core';",
      '',
      '@Component({',
      "  selector: 'x-cut',",
      '  template: `',
      '    <text>before</text>',
      '    @if (on() {',
      '      <text>inside</text>',
      '    }',
      '    <text>after</text>',
      '  `,',
      '})',
      'export class Cut {',
      '  on() { return true; }',
      '}',
      '',
    ].join('\n');

    const error = failure(() => transformBroken('cut-template.ts', src));

    assert.deepEqual(error.loc, { line: 7, column: 4 });
    const message = stripVTControlCharacters(error.message);
    assert.ok(message.includes("cut-template.ts: Cut's template does not parse"), message);
    assert.match(message, /Incomplete block "if"/);
    assert.match(message, />\s*7 \|\s+@if \(on\(\) \{/, 'with the line quoted');
  });

  it('fails the same way in a release build and under a test, which share the transform', () => {
    const src =
      "import { Component } from '@angular/core';\n" +
      "@Component({ selector: 'x-cut', template: '<text>a</text> @let total = 1 <text>b</text>' })\n" +
      'export class Cut {}\n';
    assert.throws(() => transformAngular(src, '/x/cut.ts'), /Incomplete @let declaration/);
    assert.throws(() => transformAngular(src, '/x/cut.ts', { dev: true }), /Incomplete @let/);
  });

  it('names the file, line and column of an external template', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cut-template-'));
    try {
      const html = path.join(dir, 'cut.html');
      writeFileSync(
        html,
        '<text>before</text>\n@for (item of items; track item {\n  <text>x</text>\n}\n',
      );
      const file = path.join(dir, 'cut.ts');
      const src =
        "import { Component } from '@angular/core';\n" +
        "@Component({ selector: 'x-cut', templateUrl: './cut.html' })\n" +
        'export class Cut { items = [1]; }\n';
      const error = failure(() => transformAngular(src, file));
      assert.match(error.message, /Incomplete block "for"/);
      assert.ok(error.message.includes(`${html}:2:1`), error.message);
      assert.equal(error.loc, undefined, 'no line of the .ts file is claimed');

      // Editing the template alone is transformed as the template's own module, in dev.
      writeFileSync(file, src);
      const edited = failure(() =>
        transformAngular(readFileSync(html, 'utf8'), html, { dev: true }),
      );
      assert.match(edited.message, /Incomplete block "for"/);
      assert.ok(edited.message.includes(`${html}:2:1`), edited.message);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves a template that parses alone', () => {
    const src =
      "import { Component } from '@angular/core';\n" +
      "@Component({ selector: 'x-fine', template: '@let n = 1; @if (n) { <text>{{ n }}</text> } " +
      '@else { <text>none</text> } @for (i of [1, 2]; track i) { <text>{{ i }}</text> } ' +
      "@switch (n) { @case (1) { <text>one</text> } @default { <text>other</text> } }' })\n" +
      'export class Fine {}\n';
    assert.doesNotThrow(() => transformAngular(src, '/x/fine.ts'));
  });
});

describe('source positions, with an external template or stylesheet', () => {
  // An external resource is pulled into Metro's graph by an import put in front of the compiled
  // code. Those lines have no original: mapping them must not ask the source map for line 0.
  it('compiles without asking the map for a line before the first', () => {
    const transformer = require('@ng-native/metro/transformer.cjs') as {
      transform(params: {
        filename: string;
        src: string;
        options: { dev: boolean };
        plugins: unknown[];
      }): { ast: object };
    };
    const filename = fixture('external.ts');
    const src = readFileSync(filename, 'utf8');

    assert.doesNotThrow(() =>
      transformer.transform({ filename, src, options: { dev: true }, plugins: [] }),
    );
  });
});

describe('a styles expression the build cannot read', () => {
  // The compiler reads a literal, a template literal and a same-file constant, and drops any other
  // expression with no error: the component rendered unstyled and its sheet was never checked.
  const { transformAngular } = require('@ng-native/metro/angular-transform.cjs') as {
    transformAngular: (src: string, filename: string, options?: object) => { code: string };
  };
  const component = (preamble: string, styles: string) =>
    [
      "import { Component } from '@angular/core';",
      preamble,
      `@Component({ selector: 'x-s', template: '<view class="box"></view>', styles: ${styles} })`,
      'export class Styled {}',
    ].join('\n');
  const sheet = (code: string) => code.slice(code.indexOf('ɵnativeStyles'));
  const imported = "import { SHARED } from './shared';";

  it('fails the build on an imported constant, naming the component and the expression', () => {
    assert.throws(
      () => transformAngular(component(imported, 'SHARED'), '/tmp/a.ts'),
      (error: Error) => {
        assert.match(error.message, /\/tmp\/a\.ts: Styled's styles/);
        assert.match(error.message, /"SHARED"/);
        assert.match(error.message, /styleUrl/);
        return true;
      },
    );
  });

  it('fails the build on a concatenation', () => {
    const preamble = "const CSS = '.box { width: 50px; }';";
    assert.throws(
      () => transformAngular(component(preamble, "CSS + ' .x {}'"), '/tmp/b.ts'),
      /Styled's styles.*"CSS \+ ' \.x \{\}'"/s,
    );
  });

  it('fails the build on one unreadable entry in an otherwise literal array', () => {
    assert.throws(
      () => transformAngular(component(imported, "[SHARED, '.box { width: 50px; }']"), '/tmp/c.ts'),
      (error: Error) => {
        assert.match(error.message, /"SHARED"/);
        assert.doesNotMatch(error.message, /width: 50px/, 'only the entry that was dropped');
        return true;
      },
    );
  });

  it('fails the build on a spread and on a constant that holds an array', () => {
    const preamble = "const SHEETS = ['.box { width: 50px; }'];";
    assert.throws(
      () => transformAngular(component(preamble, '[...SHEETS]'), '/tmp/d.ts'),
      /"\.\.\.SHEETS"/,
    );
    assert.throws(() => transformAngular(component(preamble, 'SHEETS'), '/tmp/e.ts'), /"SHEETS"/);
  });

  it('fails the build on a shorthand styles property naming an imported constant', () => {
    const src = [
      "import { Component } from '@angular/core';",
      "import { styles } from './shared';",
      "@Component({ selector: 'x-s', template: '<view></view>', styles })",
      'export class Styled {}',
    ].join('\n');
    assert.throws(() => transformAngular(src, '/tmp/g.ts'), /Styled's styles.*"styles"/s);
  });

  it('compiles every form it can read', () => {
    const preamble = "const CSS = '.box { width: 50px; }';";
    const forms = ["'.box { width: 50px; }'", 'CSS', '[CSS]', "[CSS, '.x { height: 1px; }']"];
    for (const styles of [...forms, '`${CSS}`']) {
      const { code } = transformAngular(component(preamble, styles), '/tmp/f.ts');
      assert.match(sheet(code), /"width":50/, styles);
    }
  });

  it('does not mistake a styles key in a comment or a string for the property', () => {
    const src = [
      "import { Component } from '@angular/core';",
      '@Component({',
      "  selector: 'x-s',",
      "  // styles: SHARED, isn't read",
      "  template: '<text>styles: nothing</text>',",
      "  styles: '.box { width: 50px; }',",
      '})',
      'export class Styled {}',
    ].join('\n');
    assert.match(sheet(transformAngular(src, '/tmp/g.ts').code), /"width":50/);
  });

  it('checks each component in a file on its own', () => {
    const src = [
      "import { Component } from '@angular/core';",
      imported,
      "@Component({ selector: 'x-a', template: '<view></view>', styles: '.a { width: 1px; }' })",
      'export class Fine {}',
      "@Component({ selector: 'x-b', template: '<view></view>', styles: SHARED })",
      'export class Dropped {}',
    ].join('\n');
    assert.throws(() => transformAngular(src, '/tmp/h.ts'), /Dropped's styles/);
  });
});

describe("the transformer's cache key", () => {
  it("adds the compiler's own version to Expo's, so an edit to the compiler invalidates it", () => {
    const ours = require('@ng-native/metro/transformer.cjs') as { getCacheKey(): string };
    const fromMetro = createRequire(require.resolve('@ng-native/metro/transformer.cjs'));
    const expo = fromMetro('@expo/metro-config/build/babel-transformer') as {
      getCacheKey?(): string;
    };
    const theirs = expo.getCacheKey?.() ?? '';
    assert.ok(ours.getCacheKey().startsWith(theirs));
    assert.match(ours.getCacheKey().slice(theirs.length), /^[0-9a-f]{12}$/);
  });
});

describe('a component whose styles compile to nothing', () => {
  it('carries no sheet at all, rather than an empty one', () => {
    const { transformAngular } = require('@ng-native/metro/angular-transform.cjs') as {
      transformAngular: (src: string, filename: string, options?: object) => { code: string };
    };
    const src = [
      "import { Component } from '@angular/core';",
      "@Component({ selector: 'x-e', template: '<view></view>', styles: '.a { float: left; }' })",
      'export class Empty {}',
    ].join('\n');
    const { result } = warned(() => transformAngular(src, '/tmp/empty.ts'));
    assert.doesNotMatch(result.code, /ɵnativeStyles/);
  });
});
