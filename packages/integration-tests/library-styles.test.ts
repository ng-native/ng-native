/**
 * A library's component CSS, compiled into native sheets when the app opts the package in with
 * `libraryStyles`. Three layers, because the list has a way to travel: the preset records it on
 * the transformer config, the transform worker carries it into the bundle's transform options,
 * and the transformer reads it from there and compiles each declared component's `styles` into
 * the sheet on its class, as it does for the app's own components.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { transformAngular } = require('@ng-native/metro/angular-transform.cjs') as {
  transformAngular: (
    src: string,
    filename: string,
    options?: { dev?: boolean; platform?: string; libraryStyles?: string[] | false },
  ) => { code: string };
};
const { transformAngularFileSync } = require('@oxc-angular/vite/api') as {
  transformAngularFileSync: (src: string, file: string, options: object) => { code: string };
};

/**
 * A library's component as npm ships it: partial-compiled, its CSS written for a browser. Plain
 * JavaScript, as a published library is: the Angular stage leaves TypeScript syntax in place.
 */
function partial(source: string, file: string): string {
  const { code } = transformAngularFileSync(source, file, { compilationMode: 'partial' });
  assert.match(code, /ɵɵngDeclareComponent/, 'the fixture really is partial-compiled');
  return code;
}

const CHIP = `import {Component, input} from '@angular/core';
@Component({
  selector: 'acme-chip',
  template: '<text>chip</text>',
  host: { '[attr.data-tone]': 'tone()' },
  styles: [
    ':host { display: inline-flex; padding: 4px 8px; background: var(--surface) }',
    ':host([data-tone="warm"]) { background: #fa7319; color: white }',
  ],
})
export class Chip {
  tone = input('cool');
  /** An input called type, which a reader of the declaration must not take for the class. */
  type = input('solid');
}`;

const FILE = '/app/node_modules/@acme/ui/fesm2022/acme-ui.mjs';

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

interface Rule {
  declarations: object;
  compounds: { attributes?: unknown[] }[];
  deferred?: unknown[];
}

const scratch = mkdtempSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '.library-styles-'),
);
after(() => rmSync(scratch, { recursive: true, force: true }));
let loaded = 0;

/** A transformed module, loaded as the app would load it: a file of its own, beside the app's. */
async function load(code: string): Promise<Record<string, unknown>> {
  const file = path.join(scratch, `module-${loaded++}.mjs`);
  writeFileSync(file, code);
  return import(pathToFileURL(file).href);
}

/** The sheet `className` carries once its module has loaded, or null when it has none. */
async function sheetOf(code: string, className: string): Promise<{ rules: Rule[] } | null> {
  const type = (await load(code))[className] as Record<string, unknown> | undefined;
  return (type?.['ɵnativeStyles'] as { rules: Rule[] } | undefined) ?? null;
}

describe("a library's component CSS, opted in", () => {
  const source = partial(CHIP, FILE);

  it('compiles the CSS as shipped into a sheet on the class, host attribute rules included', async () => {
    const { result, warnings } = warned(() =>
      transformAngular(source, FILE, { dev: false, platform: 'ios', libraryStyles: ['@acme/ui'] }),
    );
    assert.deepEqual(warnings, []);
    assert.match(result.code, /ɵɵdefineComponent/, 'the linker still ran');
    assert.doesNotMatch(result.code, /_nghost-%COMP%/, 'the shimmed CSS is still stripped');
    const sheet = (await sheetOf(result.code, 'Chip'))!;
    assert.ok(sheet, 'the sheet is on the class');
    assert.deepEqual(
      sheet.rules.map((rule) => rule.declarations),
      [
        { display: 'flex', paddingTop: 4, paddingRight: 8, paddingBottom: 4, paddingLeft: 8 },
        { backgroundColor: 'rgb(250, 115, 25)', color: 'rgb(255, 255, 255)' },
      ],
    );
    assert.deepEqual(
      sheet.rules[1]!.compounds,
      [
        {
          classes: [],
          host: true,
          attributes: [{ name: 'data-tone', operator: 'equal', value: 'warm' }],
        },
      ],
      'the :host([attr]) rule is read from the CSS before the linker shimmed it',
    );
    assert.deepEqual(
      sheet.rules[0]!.deferred,
      [{ props: ['backgroundColor'], kind: 'color', reference: '--surface' }],
      "a token in the library's background is read on device",
    );
  });

  it('compiles it in a dev build as well, beside the CSS the dev build keeps', async () => {
    const { code } = transformAngular(source, FILE, {
      dev: true,
      platform: 'ios',
      libraryStyles: ['@acme/ui'],
    });
    assert.match(code, /_nghost-%COMP%/);
    assert.ok(await sheetOf(code, 'Chip'));
  });

  it('leaves a web build alone, where the browser applies the CSS itself', async () => {
    const { code } = transformAngular(source, FILE, {
      platform: 'web',
      libraryStyles: ['@acme/ui'],
    });
    assert.match(code, /_nghost-%COMP%/);
    assert.equal(await sheetOf(code, 'Chip'), null);
  });

  it('compiles it with no option at all: every library has its styles', async () => {
    const { code } = transformAngular(source, FILE, { dev: false, platform: 'ios' });
    const sheet = (await sheetOf(code, 'Chip'))!;
    assert.ok(sheet.rules.length > 0);
  });

  it('leaves a package a list leaves out, and every package for `false`: linked, stripped, no sheet', async () => {
    for (const libraryStyles of [['@acme/other'], [], false as const]) {
      const { code } = transformAngular(source, FILE, {
        dev: false,
        platform: 'ios',
        libraryStyles,
      });
      assert.match(code, /ɵɵdefineComponent/);
      assert.doesNotMatch(code, /ɵnativeStyles/, JSON.stringify(libraryStyles));
    }
  });

  it('warns for what native cannot express, naming the file, the line and the class', async () => {
    const file = '/app/node_modules/x-ui/ui.mjs';
    const hover = partial(
      `import {Component} from '@angular/core';
       @Component({selector: 'x-b', template: '<text>b</text>', styles: ['.b { color: red; -webkit-font-smoothing: antialiased }\\n.b:hover { color: blue }']})
       export class B {}`,
      file,
    );
    const { result, warnings } = await everyWarning(() =>
      warned(() =>
        transformAngular(hover, file, { dev: false, platform: 'ios', libraryStyles: ['x-ui'] }),
      ),
    );
    const line = hover.slice(0, hover.indexOf('.b { color')).split('\n').length;
    assert.equal(warnings.length, 2);
    assert.match(
      warnings[0]!,
      new RegExp(`^\\[angular-native\\] ${file}:${line} \\(B\\): dropped '-webkit-font-smoothing'`),
    );
    assert.match(
      warnings[1]!,
      new RegExp(
        `${file}:${line} \\(B, line 2 of its styles\\): dropped a rule: ':hover' is not supported`,
      ),
    );
    assert.deepEqual(
      (await sheetOf(result.code, 'B'))!.rules.map((rule) => rule.declarations),
      [{ color: 'rgb(255, 0, 0)' }],
      'the rest of the rule still applies',
    );
  });

  it('finds the package under a pnpm path, and the one the file is in rather than the one above', async () => {
    const nested =
      '/app/node_modules/.pnpm/@acme+ui@1.0.0/node_modules/@acme/ui/fesm2022/acme-ui.mjs';
    const listed = transformAngular(partial(CHIP, nested), nested, {
      dev: false,
      platform: 'ios',
      libraryStyles: ['@acme/ui'],
    }).code;
    assert.ok(await sheetOf(listed, 'Chip'));

    const inner = '/app/node_modules/@acme/ui/node_modules/x-dep/dep.mjs';
    const dependency = transformAngular(partial(CHIP, inner), inner, {
      dev: false,
      platform: 'ios',
      libraryStyles: ['@acme/ui'],
    }).code;
    assert.equal(
      await sheetOf(dependency, 'Chip'),
      null,
      'a dependency of the library is not the library',
    );
  });

  it("finds a linked workspace package by its package.json's name", async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'linked-ui-'));
    try {
      const lib = path.join(root, 'libs', 'ui');
      mkdirSync(path.join(lib, 'src'), { recursive: true });
      writeFileSync(path.join(lib, 'package.json'), '{ "name": "@acme/linked-ui" }');
      const file = path.join(lib, 'src', 'chip.mjs');
      writeFileSync(file, '');
      const code = transformAngular(partial(CHIP, file), file, {
        dev: false,
        platform: 'ios',
        libraryStyles: ['@acme/linked-ui'],
      }).code;
      assert.ok(await sheetOf(code, 'Chip'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads the CSS as the literal means it, escapes included', async () => {
    const file = '/app/node_modules/x-ui/quoted.mjs';
    const quoted = partial(
      `import {Component} from '@angular/core';
       @Component({selector: 'x-q', template: '<text>q</text>', styles: ['.q[data-k="a b"] {\\n  color: red;\\n}\\n.q::after { content: "\\\\201C" }']})
       export class Q {}`,
      file,
    );
    assert.match(quoted, /\\n/, 'the literal carries escaped line breaks');
    const { result, warnings } = await everyWarning(() =>
      warned(() =>
        transformAngular(quoted, file, { dev: false, platform: 'ios', libraryStyles: ['x-ui'] }),
      ),
    );
    const sheet = (await sheetOf(result.code, 'Q'))!;
    assert.deepEqual(sheet.rules[0]!.declarations, { color: 'rgb(255, 0, 0)' });
    assert.deepEqual(sheet.rules[0]!.compounds[0]!.attributes, [
      { name: 'data-k', operator: 'equal', value: 'a b' },
    ]);
    assert.equal(warnings.length, 1, "the pseudo-element rule is refused, as the app's would be");
    assert.match(warnings[0]!, /pseudo-elements/);
  });

  it('gives each component in a file its own sheet, and one with no styles none', async () => {
    const file = '/app/node_modules/x-ui/pair.mjs';
    const pair = partial(
      `import {Component} from '@angular/core';
       @Component({selector: 'x-a', template: '<text>a</text>', styles: ['.a { color: red }']})
       export class A {}
       @Component({selector: 'x-plain', template: '<text>plain</text>'})
       export class Plain {}
       @Component({selector: 'x-c', template: '<text>c</text>', styles: ['.c { color: blue }', '.d { color: green }']})
       export class C {}`,
      file,
    );
    const { code } = transformAngular(pair, file, {
      dev: false,
      platform: 'ios',
      libraryStyles: ['x-ui'],
    });
    assert.deepEqual(
      (await sheetOf(code, 'A'))!.rules.map((rule) => rule.declarations),
      [{ color: 'rgb(255, 0, 0)' }],
    );
    assert.equal(await sheetOf(code, 'Plain'), null);
    assert.deepEqual(
      (await sheetOf(code, 'C'))!.rules.map((rule) => rule.declarations),
      [{ color: 'rgb(0, 0, 255)' }, { color: 'rgb(0, 128, 0)' }],
    );
  });
});

describe('how the list reaches the transformer', () => {
  /** Our worker in front of a stand-in for Expo's that hands back the options it was given. */
  function worker() {
    const root = mkdtempSync(path.join(tmpdir(), 'library-styles-worker-'));
    const dir = path.join(root, 'node_modules/@expo/metro-config/build/transform-worker');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'transform-worker.js'),
      'module.exports = { transform: (c, p, f, d, options) => options };',
    );
    const ours = require('@ng-native/metro/transform-worker.cjs') as {
      transform(...args: unknown[]): { customTransformOptions?: Record<string, unknown> };
    };
    const upstream = path.relative(root, path.join(dir, 'transform-worker.js'));
    const run = (config: object, options: object) =>
      ours.transform(
        { angularNativeUpstreamTransformer: upstream, ...config },
        root,
        path.join(root, 'app.ts'),
        Buffer.from(''),
        options,
      );
    return { run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  it("the worker puts the preset's list into the bundle's customTransformOptions", () => {
    const { run, cleanup } = worker();
    try {
      const options = run(
        { angularNativeLibraryStyles: ['@acme/ui'] },
        { platform: 'ios', customTransformOptions: { dom: 'kept' } },
      );
      assert.deepEqual(options.customTransformOptions, {
        dom: 'kept',
        angularNativeLibraryStyles: ['@acme/ui'],
      });
    } finally {
      cleanup();
    }
  });

  it('the worker leaves the options alone when the preset recorded no list', () => {
    const { run, cleanup } = worker();
    try {
      const given = { platform: 'ios', customTransformOptions: { dom: 'kept' } };
      assert.equal(run({}, given), given);
      // An empty list is one: no library's styles, which the transformer has to be told.
      assert.deepEqual(run({ angularNativeLibraryStyles: [] }, given), {
        platform: 'ios',
        customTransformOptions: { dom: 'kept', angularNativeLibraryStyles: [] },
      });
    } finally {
      cleanup();
    }
  });

  it('the transformer compiles a listed library from customTransformOptions, end to end', () => {
    const transformer = require('@ng-native/metro/transformer.cjs') as {
      transform(params: object): { ast: object };
    };
    const generate = (require('@babel/generator') as { default: Function }).default;
    const run = (customTransformOptions?: object) =>
      generate(
        transformer.transform({
          filename: FILE,
          src: partial(CHIP, FILE),
          options: { dev: false, platform: 'ios', projectRoot: '/app', customTransformOptions },
          plugins: [],
        }).ast,
      ).code as string;
    assert.match(run({ angularNativeLibraryStyles: ['@acme/ui'] }), /\["ɵnativeStyles"\] = /);
    assert.match(run(undefined), /ɵnativeStyles/, 'no list is every library');
    assert.doesNotMatch(run({ angularNativeLibraryStyles: [] }), /ɵnativeStyles/);
  });
});

/** A library file as ng-packagr builds it (`fixtures/ng-packagr`), linked as a native build would. */
function shipped(name: string, options: { dev?: boolean; libraryStyles?: string[] } = {}) {
  const file = `/app/node_modules/@acme/extras/fesm2022/${name}`;
  const src = readFileSync(new URL(`./fixtures/ng-packagr/${name}`, import.meta.url), 'utf8');
  return warned(() =>
    transformAngular(src, file, {
      dev: false,
      platform: 'ios',
      libraryStyles: ['@acme/extras'],
      ...options,
    }),
  );
}

/** Each warning in full rather than the summary, for as long as `run` takes. */
async function everyWarning<T>(run: () => T | Promise<T>): Promise<T> {
  process.env['ANGULAR_NATIVE_LIBRARY_WARNINGS'] = 'all';
  try {
    return await run();
  } finally {
    delete process.env['ANGULAR_NATIVE_LIBRARY_WARNINGS'];
  }
}

describe("a library's sheet, attached to its definition", () => {
  it('loads a file that quotes a whole declaration in a string, and styles the real one', async () => {
    const { result } = shipped('acme-extras.mjs');
    const docs = await sheetOf(result.code, 'Docs');
    assert.deepEqual(docs?.rules[0]?.declarations, {
      paddingTop: 1,
      paddingRight: 1,
      paddingBottom: 1,
      paddingLeft: 1,
    });
  });

  it('reaches a class a minifier left named only inside its own body', async () => {
    // `var x = class r { static { this.ɵcmp = ...({ type: r }) } }`: `r` is no name outside the
    // class. The linker's own output does not load here (its template functions name `i0` where
    // the file's namespace is `t`), so `i0` is given to it as a linker that named it would.
    const { result } = shipped('acme-extras.min.mjs');
    const mod = await load(`import * as i0 from "@angular/core";\n${result.code}`);
    const card = (mod['Card'] as Record<string, unknown>)['ɵnativeStyles'] as { rules: Rule[] };
    assert.deepEqual(card.rules[0]?.declarations, {
      display: 'flex',
      paddingTop: 4,
      paddingRight: 4,
      paddingBottom: 4,
      paddingLeft: 4,
    });
  });
});

describe('CSS a library writes that does not parse', () => {
  it('drops that rule with a warning and keeps the rest, as Chrome does', async () => {
    // Chrome 154 drops `.ripple::after:not(:empty)` and applies `.ripple` and `:host`.
    const { result, warnings } = await everyWarning(() => shipped('acme-extras.mjs'));
    const toggle = (await sheetOf(result.code, 'Toggle'))!;
    assert.deepEqual(
      toggle.rules.map((rule) => rule.declarations),
      [
        { paddingTop: 2, paddingRight: 2, paddingBottom: 2, paddingLeft: 2 },
        { color: 'rgb(4, 5, 6)' },
      ],
    );
    const refused = warnings.filter((warning) => warning.includes('(Toggle'));
    assert.equal(refused.length, 1);
    assert.match(
      refused[0]!,
      /acme-extras\.mjs:107 \(Toggle\): dropped a rule that does not parse/,
    );
  });
});

describe('a library declaration this cannot read', () => {
  it('says so, rather than leaving the component unstyled in silence', async () => {
    const file = '/app/node_modules/x-ui/odd.mjs';
    const src = `import * as i0 from "@angular/core";
const SHARED = ":host { color: red }";
export class Odd {
  static ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "14.0.0", version: "22.2.0", type: Odd, selector: "x-odd", ngImport: i0, template: "", isInline: true, styles: [SHARED] });
}`;
    const { warnings } = await everyWarning(() =>
      warned(() =>
        transformAngular(src, file, { dev: false, platform: 'ios', libraryStyles: ['x-ui'] }),
      ),
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /x-ui\/odd\.mjs:4 \(Odd\): its styles are not a list of strings/);
  });
});

describe('where a warning about a library points', () => {
  it('names the line of the literal, and the line of its styles, when it escapes its line breaks', async () => {
    const file = '/app/node_modules/x-ui/lines.mjs';
    const src = partial(
      `import {Component} from '@angular/core';
       @Component({selector: 'x-l', template: '', styles: ['.k {\\n  display: flex;\\n}\\n.l {\\n  -webkit-font-smoothing: antialiased;\\n}\\n']})
       export class L {}`,
      file,
    );
    const line = src.slice(0, src.indexOf('.k {')).split('\n').length;
    const { warnings } = await everyWarning(() =>
      warned(() =>
        transformAngular(src, file, { dev: false, platform: 'ios', libraryStyles: ['x-ui'] }),
      ),
    );
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0]!,
      new RegExp(
        `lines\\.mjs:${line} \\(L, line 4 of its styles\\): dropped '-webkit-font-smoothing'`,
      ),
    );
  });
});

describe('how much a library says', () => {
  it('prints one line a file by default, counting what it dropped and why', () => {
    const { warnings } = shipped('acme-extras.mjs');
    assert.deepEqual(warnings, [
      '[angular-native] @acme/extras (fesm2022/acme-extras.mjs): 3 sheets, 3 declarations and ' +
        "rules dropped: a pseudo-element 1, '::ng-deep' 1, CSS that does not parse 1. Set " +
        'ANGULAR_NATIVE_LIBRARY_WARNINGS=all to see each one.',
    ]);
  });

  it('lists each one with ANGULAR_NATIVE_LIBRARY_WARNINGS=all', async () => {
    const { warnings } = await everyWarning(() => shipped('acme-extras.mjs'));
    assert.equal(warnings.length, 3);
    for (const warning of warnings) {
      assert.match(
        warning,
        /^\[angular-native\] \/app\/node_modules\/@acme\/extras\/fesm2022\/acme-extras\.mjs:\d+ \((Card|Toggle)/,
      );
    }
  });

  it('says nothing for a library whose CSS all compiles', () => {
    const { warnings } = warned(() =>
      transformAngular(partial(CHIP, FILE), FILE, {
        dev: false,
        platform: 'ios',
        libraryStyles: ['@acme/ui'],
      }),
    );
    assert.deepEqual(warnings, []);
  });
});

describe("a library file's package, from a path Metro gives relative to the project", () => {
  it('reads the path against the project root, not the directory the build started in', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'relative-ui-'));
    try {
      const lib = path.join(root, 'libs', 'ui', 'dist');
      mkdirSync(path.join(lib, 'fesm2022'), { recursive: true });
      writeFileSync(path.join(lib, 'package.json'), '{ "name": "@acme/relative-ui" }');
      const relative = 'libs/ui/dist/fesm2022/chip.mjs';
      const code = transformAngular(partial(CHIP, relative), relative, {
        dev: false,
        platform: 'ios',
        libraryStyles: ['@acme/relative-ui'],
        projectRoot: root,
      } as never).code;
      assert.notEqual(process.cwd(), root);
      assert.ok(await sheetOf(code, 'Chip'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('a transform worker that does not carry the list', () => {
  it('says the list is not applied when a file arrives without it', () => {
    // What `withAngularNative` leaves for its workers, which a worker it did not install never
    // turns into the transform options. Every library is then styled, the ones left out too.
    const transformer = require('@ng-native/metro/transformer.cjs') as {
      transform(params: object): unknown;
    };
    const run = (filename: string, customTransformOptions?: object) =>
      warned(() =>
        transformer.transform({
          filename,
          src: partial(CHIP, filename),
          options: { dev: false, platform: 'ios', projectRoot: '/app', customTransformOptions },
          plugins: [],
        }),
      ).warnings;
    assert.deepEqual(run(FILE), [], 'no list was given: nothing is missing');
    // An empty one too, which is what `libraryStyles: false` leaves.
    process.env['ANGULAR_NATIVE_LIBRARY_STYLES'] = '';
    try {
      assert.deepEqual(run(FILE, { angularNativeLibraryStyles: [] }), []);
      const missing = run(FILE);
      assert.equal(missing.length, 1);
      assert.match(
        missing[0]!,
        /libraryStyles is set, but .*acme-ui\.mjs arrived without it.*transformerPath/,
      );
      assert.deepEqual(run(FILE), [], 'once a build, not once a file');
    } finally {
      delete process.env['ANGULAR_NATIVE_LIBRARY_STYLES'];
    }
  });
});

describe("an @ng-native package's own components, installed from npm", () => {
  const source = fileURLToPath(new URL('../components/', import.meta.url));
  const root = mkdtempSync(path.join(tmpdir(), 'ng-native-dist-styles-'));
  const dist = path.join(root, 'node_modules/@ng-native/components/dist');
  after(() => rmSync(root, { recursive: true, force: true }));

  /** The file as `ngc` publishes it, transformed for an app that lists no `libraryStyles`. */
  function published(name: string): { code: string; warnings: string[] } {
    if (!existsSync(dist)) {
      const compiler = path.dirname(require.resolve('@angular/compiler-cli/package.json'));
      const ngc = path.join(compiler, 'bundles/src/bin/ngc.js');
      execFileSync(process.execPath, [ngc, '-p', 'tsconfig.build.json', '--outDir', dist], {
        cwd: source,
        stdio: 'pipe',
      });
    }
    const file = path.join(dist, name);
    const { result, warnings } = warned(() =>
      transformAngular(readFileSync(file, 'utf8'), file, { dev: false, platform: 'ios' }),
    );
    return { code: result.code, warnings };
  }

  /** The sheet the transform put on the one declaration in `code` that has one. */
  function attached(code: string): { rules: (Rule & { condition?: object })[] } {
    const marker = 'd.type["ɵnativeStyles"] = ';
    const start = code.indexOf(marker);
    assert.notEqual(start, -1, 'the declaration carries a sheet');
    const literal = code.slice(start + marker.length, code.indexOf('), d))(', start));
    return JSON.parse(literal);
  }

  it('gives <markdown> its default md-* sheet, light and dark, with no libraryStyles', () => {
    const { code, warnings } = published('markdown.js');
    assert.deepEqual(warnings, []);
    assert.match(code, /ɵɵdefineComponent/, 'the linker still ran');
    const rules = attached(code).rules;
    const classes = new Set(
      rules.flatMap((rule) => rule.compounds.flatMap((c) => (c as { classes: string[] }).classes)),
    );
    for (const name of ['md-h1', 'md-p', 'md-a', 'md-code', 'md-pre', 'md-table', 'md-img']) {
      assert.ok(classes.has(name), name);
    }
    assert.ok(
      rules.some((rule) => rule.condition !== undefined),
      'the dark scheme rules came along',
    );
  });

  it('gives <touchable-opacity> its resting opacity and fade, with no libraryStyles', () => {
    const { code, warnings } = published('touchable-opacity.js');
    assert.deepEqual(warnings, []);
    const rules = attached(code).rules;
    assert.ok(
      rules.some((rule) => 'opacity' in (rule.declarations as Record<string, unknown>)),
      JSON.stringify(rules),
    );
  });
});
