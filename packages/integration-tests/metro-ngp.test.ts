/**
 * `compilation: 'ngp'`: Angular's hybrid compiler (a Rust analysis pass and Angular's own template
 * compiler) in place of oxc, opted into from the Metro preset.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { withAngularNative } = require('@ng-native/metro/config.cjs');
const { transformAngularWithNgp, takeResourcesRead } =
  require('@ng-native/metro/angular-transform.cjs') as {
    transformAngularWithNgp(
      src: string,
      filename: string,
      options: Record<string, unknown>,
    ): Promise<{ code: string; dependencies: string[] }>;
    takeResourcesRead(filename: string): string[];
  };
const { closeNgp } = require('@ng-native/metro/ngp-compile.cjs') as { closeNgp(): Promise<void> };
const { documentOf, TsgoChecker } = require('@ng-native/metro/tsgo-checker.cjs') as {
  TsgoChecker: new (tsconfig: string) => {
    check(file: string, source: string): Promise<string[]>;
    exitError?: Error;
    close(): void;
  };
  documentOf(
    filePath: string,
    source: string,
    tcb?: string,
  ): { text: string; sourceLineCount: number; range: unknown };
};

const EXPO = '/app/node_modules/@expo/metro-config/build/transform-worker/transform-worker.js';

interface Config {
  projectRoot: string;
  transformerPath?: string;
  transformer: { cacheVersion?: string; angularNativeCompilation?: Record<string, unknown> };
  resolver: { sourceExts: string[] };
  serializer: { getPolyfills(options: unknown): string[] };
}

const base = (): Config => ({
  projectRoot: '/app',
  transformerPath: EXPO,
  transformer: {},
  resolver: { sourceExts: ['ts', 'tsx', 'js'] },
  serializer: { getPolyfills: () => [] },
});

describe("the preset's compilation option", () => {
  it('compiles with oxc and records nothing when the option is not given', () => {
    const config = withAngularNative(base()) as Config;
    assert.equal(config.transformer.angularNativeCompilation, undefined);
    assert.doesNotMatch(config.transformer.cacheVersion!, /ngp-/);
  });

  it("records 'ngp' with type checking on, and puts the NGP build in Metro's cacheVersion", () => {
    const config = withAngularNative(base(), { compilation: 'ngp' }) as Config;
    assert.deepEqual(config.transformer.angularNativeCompilation, {
      compilation: 'ngp',
      typeCheck: true,
    });
    assert.match(config.transformer.cacheVersion!, /ngp-[0-9a-f]{12}-typecheck/);
  });

  it('turns type checking off with disableTypeChecking, under a different cacheVersion', () => {
    const checked = withAngularNative(base(), { compilation: 'ngp' }) as Config;
    const unchecked = withAngularNative(base(), {
      compilation: 'ngp',
      disableTypeChecking: true,
    }) as Config;
    assert.equal(unchecked.transformer.angularNativeCompilation!['typeCheck'], false);
    assert.notEqual(checked.transformer.cacheVersion, unchecked.transformer.cacheVersion);
    const oxc = withAngularNative(base(), { compilation: 'oxc' }) as Config;
    assert.notEqual(oxc.transformer.cacheVersion, checked.transformer.cacheVersion);
  });

  it("puts the tsconfig and what it extends in Metro's cacheVersion", () => {
    const dir = mkdtempSync(path.join(import.meta.dirname, '.ngp-tsconfig-'));
    try {
      writeFileSync(path.join(dir, 'base.json'), '{ "angularCompilerOptions": {} }');
      writeFileSync(path.join(dir, 'tsconfig.json'), '{ "extends": "./base" }');
      const version = () =>
        (withAngularNative({ ...base(), projectRoot: dir }, { compilation: 'ngp' }) as Config)
          .transformer.cacheVersion;
      const first = version();
      assert.equal(version(), first);
      writeFileSync(
        path.join(dir, 'base.json'),
        '{ "angularCompilerOptions": { "strictTemplates": true } }',
      );
      const second = version();
      assert.notEqual(second, first);
      writeFileSync(path.join(dir, 'tsconfig.json'), '{ "extends": "./base", "files": [] }');
      assert.notEqual(version(), second);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves packages with the conditions of the tsconfig 'ngp' analyzes", () => {
    const dir = mkdtempSync(path.join(import.meta.dirname, '.ngp-conditions-'));
    try {
      writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
      writeFileSync(
        path.join(dir, 'tsconfig.app.json'),
        '{ "compilerOptions": { "customConditions": ["app-source"] } }',
      );
      const conditions = (options: object) =>
        (
          withAngularNative({ ...base(), projectRoot: dir }, options) as Config & {
            resolver: { unstable_conditionNames?: string[] };
          }
        ).resolver.unstable_conditionNames ?? [];
      assert.ok(
        conditions({ compilation: 'ngp', tsconfig: 'tsconfig.app.json' }).includes('app-source'),
      );
      assert.ok(!conditions({ tsconfig: 'tsconfig.app.json' }).includes('app-source'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("follows a package's own tsconfig field, and a file over a directory of the same name", () => {
    const dir = mkdtempSync(path.join(import.meta.dirname, '.ngp-extends-'));
    try {
      const preset = path.join(dir, 'node_modules/@acme/tsconfig');
      mkdirSync(path.join(preset, 'configs'), { recursive: true });
      writeFileSync(
        path.join(preset, 'package.json'),
        '{ "name": "@acme/tsconfig", "main": "./index.js", "tsconfig": "./configs/native.json" }',
      );
      writeFileSync(path.join(preset, 'index.js'), '');
      writeFileSync(path.join(preset, 'configs/native.json'), '{ "compilerOptions": {} }');
      mkdirSync(path.join(dir, 'base'));
      writeFileSync(path.join(dir, 'base.json'), '{ "compilerOptions": {} }');
      writeFileSync(path.join(dir, 'tsconfig.json'), '{ "extends": ["./base", "@acme/tsconfig"] }');
      const version = () =>
        (withAngularNative({ ...base(), projectRoot: dir }, { compilation: 'ngp' }) as Config)
          .transformer.cacheVersion;
      const first = version();
      writeFileSync(
        path.join(preset, 'configs/native.json'),
        '{ "compilerOptions": { "strict": true } }',
      );
      const second = version();
      assert.notEqual(second, first);
      writeFileSync(path.join(dir, 'base.json'), '{ "compilerOptions": { "strict": true } }');
      assert.notEqual(version(), second);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("takes the conditions a 'ngp' tsconfig inherits through extends", () => {
    const dir = mkdtempSync(path.join(import.meta.dirname, '.ngp-inherit-'));
    try {
      writeFileSync(
        path.join(dir, 'base.json'),
        '{ "compilerOptions": { "customConditions": ["from-base"] } }',
      );
      writeFileSync(path.join(dir, 'tsconfig.app.json'), '{ "extends": "./base.json" }');
      writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
      const config = withAngularNative(
        { ...base(), projectRoot: dir },
        { compilation: 'ngp', tsconfig: 'tsconfig.app.json' },
      ) as Config & { resolver: { unstable_conditionNames?: string[] } };
      assert.ok(config.resolver.unstable_conditionNames?.includes('from-base'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops a recorded compilation when the option goes away', () => {
    const config = base();
    withAngularNative(config, { compilation: 'ngp' });
    withAngularNative(config, {});
    assert.equal(config.transformer.angularNativeCompilation, undefined);
  });

  it('refuses a compiler it does not know, and options of the wrong shape', () => {
    assert.throws(
      () => withAngularNative(base(), { compilation: 'ngtsc' }),
      /compilation must be 'oxc' or 'ngp'; got "ngtsc"/,
    );
    assert.throws(
      () => withAngularNative(base(), { compilation: 'ngp', disableTypeChecking: 'yes' }),
      /disableTypeChecking must be true or false/,
    );
    assert.throws(
      () => withAngularNative(base(), { compilation: 'ngp', tsconfig: '' }),
      /tsconfig must be a path/,
    );
  });

  it("refuses 'ngp' in front of a transform worker that is not Expo's, which it cannot reach", () => {
    const config = base();
    config.transformerPath = '/app/my-worker.js';
    assert.throws(
      () => withAngularNative(config, { compilation: 'ngp' }),
      /compilation: 'ngp' needs this preset in front of Expo's transform worker.*my-worker\.js/,
    );
  });

  it("carries the option to the babel transformer through the bundle's customTransformOptions", () => {
    const root = mkdtempSync(path.join(import.meta.dirname, '.ngp-worker-'));
    try {
      writeFileSync(
        path.join(root, 'transform-worker.cjs'),
        'module.exports = { transform: (c, p, f, d, options) => options };',
      );
      const ours = require('@ng-native/metro/transform-worker.cjs') as {
        transform(...args: unknown[]): { customTransformOptions?: Record<string, unknown> };
      };
      const run = (config: object) =>
        ours.transform(
          { angularNativeUpstreamTransformer: 'transform-worker.cjs', ...config },
          root,
          path.join(root, 'app.ts'),
          Buffer.from(''),
          { platform: 'ios', customTransformOptions: { dom: 'kept' } },
        ).customTransformOptions;
      assert.deepEqual(
        run({
          angularNativeCompilation: {
            compilation: 'ngp',
            typeCheck: false,
            tsconfig: 'tsconfig.app.json',
          },
        }),
        {
          dom: 'kept',
          angularNativeCompilation: 'ngp',
          angularNativeTypeCheck: false,
          angularNativeTsconfig: 'tsconfig.app.json',
        },
      );
      assert.deepEqual(run({}), { dom: 'kept' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the type-check document', () => {
  it("appends NGP's type-check blocks after the source, and only them", () => {
    const source = 'export class Hello {}\n';
    const tcb =
      "import * as i0 from './hello';\n" +
      'const unrelated = 1;\n' +
      'function _tcb1(this: i0.Hello) { /*tcb1*/ }\n';
    const document = documentOf('/app/hello.ts', source, tcb);
    assert.equal(document.sourceLineCount, 2);
    assert.ok(document.text.startsWith(source));
    assert.match(
      document.text,
      /import \* as __ngni0 from '\.\/hello';\nfunction __ngn_tcb1\(this: __ngni0\.Hello\)/,
    );
    assert.doesNotMatch(document.text, /unrelated/);
  });

  it('gives a relative import an extension, which a nodenext project needs', () => {
    const dir = mkdtempSync(path.join(import.meta.dirname, '.ngp-tcb-'));
    try {
      writeFileSync(path.join(dir, 'hello.ts'), 'export class Hello {}\n');
      const tcb =
        "import * as i0 from './hello';\n" +
        "import * as i1 from '@angular/core';\n" +
        "import * as i2 from './missing';\n" +
        'function _tcb1(this: i0.Hello) { /*tcb1*/ }\n';
      const { text } = documentOf(path.join(dir, 'hello.ts'), 'export class Hello {}\n', tcb);
      assert.match(text, /import \* as __ngni0 from "\.\/hello\.js";/);
      assert.match(text, /import \* as __ngni1 from '@angular\/core';/);
      assert.match(text, /import \* as __ngni2 from '\.\/missing';/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the generated names apart from ones the source declares', () => {
    const source = "const i0 = 'mine';\nfunction _tcb1() {}\nexport class Hello {}\n";
    const tcb =
      "import * as i0 from './hello';\n" + 'function _tcb1(this: i0.Hello) { /*tcb1*/ }\n';
    const { text } = documentOf('/app/hello.ts', source, tcb);
    assert.ok(text.startsWith(source));
    assert.match(text, /function __ngn_tcb1\(this: __ngni0\.Hello\)/);
    assert.equal(text.match(/function _tcb1\b/g)?.length, 1);
  });

  it('reads the blocks out of a .tsx file, and never puts the source in twice', () => {
    const source = 'export const view = <b>hi</b>;\n';
    const tcb = source + 'function _tcb1(this: unknown) { /*tcb1*/ }\n';
    const split = documentOf('/app/view.tsx', source, tcb);
    assert.equal(split.text.match(/<b>hi<\/b>/g)?.length, 1);
    assert.match(split.text, /function __ngn_tcb1/);
    const unsplit = documentOf('/app/view.ts', source, tcb);
    assert.equal(unsplit.text.match(/<b>hi<\/b>/g)?.length, 1);
  });

  it('is the source alone for a file with no type-check block', () => {
    const document = documentOf('/app/plain.ts', 'export const x = 1;\n');
    assert.equal(document.text, 'export const x = 1;\n');
    assert.equal(document.range, null);
  });
});

describe('a component compiled with NGP', () => {
  const root = mkdtempSync(path.join(import.meta.dirname, '.ngp-'));
  writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'preserve',
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: true,
        paths: { '@lib/*': ['./lib/*'] },
      },
      include: ['*.ts'],
      angularCompilerOptions: { strictTemplates: true, typeCheckHostBindings: false },
    }),
  );
  const write = (name: string, text: string) => writeFileSync(path.join(root, name), text);
  const component = (name: string, decorator: string) =>
    `import { Component, NO_ERRORS_SCHEMA } from '@angular/core';\n` +
    `@Component({ selector: '${name}', schemas: [NO_ERRORS_SCHEMA], ${decorator} })\n` +
    `export class ${name[0]!.toUpperCase()}${name.slice(1)} { protected name = 'ngp'; }\n`;
  write('hello.ts', component('hello', "templateUrl: './hello.html'"));
  write('hello.html', '<text>hello {{ name }}</text>');
  write('inline.ts', component('inline', "template: '<text>{{ name }}</text>'"));

  const compile = (name: string, dev = false) =>
    transformAngularWithNgp(readFileSync(path.join(root, name), 'utf8'), name, {
      projectRoot: root,
      platform: 'ios',
      dev,
      typeCheck: false,
    });

  after(async () => {
    await closeNgp();
    rmSync(root, { recursive: true, force: true });
  });

  it('compiles the decorator away into a component definition', async () => {
    const { code } = await compile('inline.ts');
    assert.match(code, /ɵɵdefineComponent/);
    assert.doesNotMatch(code, /@Component\(/);
  });

  it('leaves the class metadata TestBed reads out of a release build, as oxc does', async () => {
    const release = await compile('inline.ts');
    assert.doesNotMatch(release.code, /ɵsetClassMetadata/);
    const dev = await compile('inline.ts', true);
    assert.match(dev.code, /ɵsetClassMetadata/);
  });

  it('reads an external template and makes it an edge Metro watches', async () => {
    const { code, dependencies } = await compile('hello.ts');
    assert.deepEqual(dependencies, ['./hello.html']);
    assert.match(code, /import "\.\/hello\.html";/);
    assert.match(code, /ɵɵtextInterpolate1\('hello ',/);
  });

  it('compiles an edited template again in a dev build, rather than the one it analysed first', async () => {
    await compile('hello.ts', true);
    write('hello.html', '<text>goodbye {{ name }}</text>');
    const later = new Date(Date.now() + 5000);
    utimesSync(path.join(root, 'hello.html'), later, later);
    const { code } = await compile('hello.ts', true);
    assert.match(code, /ɵɵtextInterpolate1\('goodbye ',/);
    assert.doesNotMatch(code, /ɵɵtextInterpolate1\('hello ',/);
  });

  it('compiles a template edited with its modification time kept', async () => {
    const template = path.join(root, 'hello.html');
    const fixed = new Date('2020-01-01T00:00:00Z');
    write('hello.html', '<text>aaaa {{ name }}</text>');
    utimesSync(template, fixed, fixed);
    await compile('hello.ts', true);
    write('hello.html', '<text>bbbb {{ name }}</text>');
    utimesSync(template, fixed, fixed);
    const { code } = await compile('hello.ts', true);
    assert.match(code, /ɵɵtextInterpolate1\('bbbb ',/);
  });

  it('compiles an edited template again in a release build too', async () => {
    write('hello.html', '<text>release {{ name }}</text>');
    await compile('hello.ts');
    write('hello.html', '<text>again {{ name }}</text>');
    const later = new Date(Date.now() + 15000);
    utimesSync(path.join(root, 'hello.html'), later, later);
    const { code } = await compile('hello.ts');
    assert.match(code, /ɵɵtextInterpolate1\('again ',/);
  });

  it('compiles a component file added after the first analysis', async () => {
    await compile('inline.ts', true);
    write('added.ts', component('added', "template: '<text>added</text>'"));
    const { code } = await compile('added.ts', true);
    assert.match(code, /ɵɵdefineComponent/);
    assert.match(code, /ɵɵtext\(1,\s*'added'\)/);
  });

  it('compiles the source Metro hands it, not the copy on disk', async () => {
    const { code } = await transformAngularWithNgp(
      component('inline', "template: '<text>from metro</text>'"),
      'inline.ts',
      { projectRoot: root, platform: 'ios', typeCheck: false },
    );
    assert.match(code, /ɵɵtext\(1,\s*'from metro'\)/);
  });

  it('analyses the source Metro hands it, so metadata only it has reaches the definition', async () => {
    const { code } = await transformAngularWithNgp(
      component('inline', "template: '<text>{{ name }}</text>'").replace(
        "selector: 'inline'",
        "selector: 'metro-inline'",
      ),
      'inline.ts',
      { projectRoot: root, platform: 'ios', typeCheck: false },
    );
    assert.match(code, /selectors: \[\['metro-inline'\]\]/);
  });

  it("goes through NGP from Metro's babel transformer when the bundle carries 'ngp'", async () => {
    const transformer = require('@ng-native/metro/transformer.cjs') as {
      transform(params: object): unknown;
    };
    const transform = (customTransformOptions: object) =>
      transformer.transform({
        filename: 'inline.ts',
        src: component('inline', "template: '<text>{{ name }}</text>'").replace(
          "selector: 'inline'",
          "selector: 'through-babel'",
        ),
        options: { dev: false, projectRoot: root, platform: 'ios', customTransformOptions },
        plugins: [],
      });
    const viaNgp = transform({ angularNativeCompilation: 'ngp', angularNativeTypeCheck: false });
    assert.ok(viaNgp instanceof Promise);
    const { ast } = (await viaNgp) as { ast: object };
    const generate = (require('@babel/generator') as { default: Function }).default;
    assert.match(generate(ast).code, /through-babel/);
    assert.equal(transform({}) instanceof Promise, false);
  });

  it('type-checks a template with tsgo, and places the error in the template file', async () => {
    write(
      'typed.ts',
      `import { Component, NO_ERRORS_SCHEMA } from '@angular/core';\n` +
        `@Component({ selector: 'typed', schemas: [NO_ERRORS_SCHEMA], templateUrl: './typed.html' })\n` +
        `export class Typed { protected count = 'one'; }\n`,
    );
    write('typed.html', '<view>\n  <text>{{ count.toFixed(2) }}</text>\n</view>\n');
    const typed = (dev: boolean) =>
      transformAngularWithNgp(readFileSync(path.join(root, 'typed.ts'), 'utf8'), 'typed.ts', {
        projectRoot: root,
        platform: 'ios',
        dev,
      });
    await assert.rejects(
      typed(true),
      /typed\.html:2:\d+ - error TS\d+: Property .toFixed. does not exist/,
    );
    write('typed.html', '<view>\n  <text>{{ count.length }}</text>\n</view>\n');
    const later = new Date(Date.now() + 10000);
    utimesSync(path.join(root, 'typed.html'), later, later);
    const { code } = await typed(true);
    assert.match(code, /ɵɵdefineComponent/);
  });

  it('type-checks a plain module of the app as well', async () => {
    write('plain.ts', 'export const total: number = "three";\n');
    await assert.rejects(
      transformAngularWithNgp('export const total: number = "three";\n', 'plain.ts', {
        projectRoot: root,
        platform: 'ios',
      }),
      /plain\.ts:1:14 - error TS2322/,
    );
    const { code } = await transformAngularWithNgp(
      'export const total: number = "three";\n',
      'plain.ts',
      { projectRoot: root, platform: 'ios', typeCheck: false },
    );
    assert.match(code, /total: number = "three"/);
  });

  it("marks a type-checked file's relative imports read, so Metro's cache misses when one changes", async () => {
    write('helper.ts', 'export const one = 1;\n');
    const src = "import { one } from './helper';\nexport const two: number = one + 1;\n";
    write('uses-helper.ts', src);
    await transformAngularWithNgp(src, 'uses-helper.ts', { projectRoot: root, platform: 'ios' });
    assert.ok(takeResourcesRead('uses-helper.ts').includes(path.join(root, 'helper.ts')));
    await transformAngularWithNgp(src, 'uses-helper.ts', {
      projectRoot: root,
      platform: 'ios',
      typeCheck: false,
    });
    assert.deepEqual(takeResourcesRead('uses-helper.ts'), []);
  });

  it('marks what a relative import imports in turn read as well', async () => {
    write('deep.ts', 'export const deep = 1;\n');
    write('middle.ts', "export { deep } from './deep';\n");
    const src = "import { deep } from './middle';\nexport const top: number = deep;\n";
    write('top.ts', src);
    await transformAngularWithNgp(src, 'top.ts', { projectRoot: root, platform: 'ios' });
    const read = takeResourcesRead('top.ts');
    assert.ok(read.includes(path.join(root, 'middle.ts')));
    assert.ok(read.includes(path.join(root, 'deep.ts')));
  });

  it('marks the .cts behind a .cjs import read', async () => {
    write('helper.cts', 'export const three = 3;\n');
    const src = "import { three } from './helper.cjs';\nexport const four: number = three + 1;\n";
    await transformAngularWithNgp(src, 'uses-cts.ts', {
      projectRoot: root,
      platform: 'ios',
      typeCheck: false,
    });
    takeResourcesRead('uses-cts.ts');
    write('uses-cts.ts', src);
    await transformAngularWithNgp(src, 'uses-cts.ts', { projectRoot: root, platform: 'ios' }).catch(
      () => undefined,
    );
    assert.ok(takeResourcesRead('uses-cts.ts').includes(path.join(root, 'helper.cts')));
  });

  it('marks a file imported through a tsconfig paths alias read', async () => {
    mkdirSync(path.join(root, 'lib'), { recursive: true });
    write('lib/aliased.ts', 'export const five = 5;\n');
    const src = "import { five } from '@lib/aliased';\nexport const six: number = five + 1;\n";
    write('uses-alias.ts', src);
    await transformAngularWithNgp(src, 'uses-alias.ts', { projectRoot: root, platform: 'ios' });
    assert.ok(takeResourcesRead('uses-alias.ts').includes(path.join(root, 'lib', 'aliased.ts')));
  });

  it("marks a component's imports read with type checking off, since its selectors decide the build", async () => {
    write(
      'parent.ts',
      "import { Inline } from './inline';\n" +
        component('parent', "imports: [Inline], template: '<inline />'"),
    );
    takeResourcesRead('parent.ts');
    await compile('parent.ts');
    assert.ok(takeResourcesRead('parent.ts').includes(path.join(root, 'inline.ts')));
  });

  it('keeps no position from an external template on the compiled component', async () => {
    write('far.ts', component('far', "templateUrl: './far.html'"));
    write('far.html', `${'\n'.repeat(40)}<text>{{ name.length }}</text>\n`);
    const transformer = require('@ng-native/metro/transformer.cjs') as {
      transform(params: object): Promise<{ ast: object }>;
    };
    const { ast } = await transformer.transform({
      filename: 'far.ts',
      src: readFileSync(path.join(root, 'far.ts'), 'utf8'),
      options: {
        dev: false,
        projectRoot: root,
        platform: 'ios',
        customTransformOptions: { angularNativeCompilation: 'ngp', angularNativeTypeCheck: false },
      },
      plugins: [],
    });
    const lines: number[] = [];
    const visit = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const loc = (node as { loc?: { start?: { line?: number } } }).loc;
      if (typeof loc?.start?.line === 'number') lines.push(loc.start.line);
      for (const [key, value] of Object.entries(node)) if (key !== 'loc') visit(value);
    };
    visit(ast);
    assert.ok(lines.length > 0);
    assert.ok(Math.max(...lines) <= 3, `a position on line ${Math.max(...lines)} of far.ts`);
  });

  it('type-checks an app .tsx file with no Angular in it', async () => {
    write('screen.tsx', 'export const count: number = "bad";\n');
    await assert.rejects(
      transformAngularWithNgp('export const count: number = "bad";\n', 'screen.tsx', {
        projectRoot: root,
        platform: 'ios',
      }),
      /screen\.tsx:1:14 - error TS2322/,
    );
  });

  const writeHost = () =>
    write(
      'host.ts',
      `import { Component } from '@angular/core';\n` +
        `@Component({ selector: 'x-map', template: '', host: { '[markers]': 'markers' } })\n` +
        `export class XMap { protected markers = []; }\n`,
    );

  it("compiles with the tsconfig's angularCompilerOptions, not NGP's defaults", async () => {
    writeHost();
    const { code } = await compile('host.ts', true);
    assert.match(code, /ɵɵdomProperty\('markers'|ɵɵproperty\('markers'/);
  });

  it('analyses again with the new angularCompilerOptions once the tsconfig changes', async () => {
    const tsconfig = path.join(root, 'tsconfig.json');
    const before = readFileSync(tsconfig, 'utf8');
    writeHost();
    try {
      await compile('host.ts', true);
      writeFileSync(
        tsconfig,
        before.replace('"typeCheckHostBindings":false', '"typeCheckHostBindings":true'),
      );
      const later = new Date(Date.now() + 20000);
      utimesSync(tsconfig, later, later);
      await assert.rejects(compile('host.ts', true), /Can't bind to 'markers'/);
    } finally {
      writeFileSync(tsconfig, before);
      const after = new Date(Date.now() + 25000);
      utimesSync(tsconfig, after, after);
    }
  });

  it('fails the build on a template error, naming the file', async () => {
    write('broken.ts', component('broken', "template: '<text>{{ name | missing }}</text>'"));
    await assert.rejects(compile('broken.ts', true), /broken\.ts: .*'missing'/);
  });
});

describe('NGP with resources and checkers of its own', () => {
  const root = mkdtempSync(path.join(import.meta.dirname, '.ngp-own-'));
  const fake = (name: string, body: string) => {
    const file = path.join(root, name);
    writeFileSync(file, `#!/usr/bin/env node\n${body}\n`);
    chmodSync(file, 0o755);
    return file;
  };
  const env = (name: string, value: string | undefined) => {
    const before = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    return () => {
      if (before === undefined) delete process.env[name];
      else process.env[name] = before;
    };
  };
  mkdirSync(path.join(root, 'src'));
  mkdirSync(path.join(root, 'generated'));
  writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'preserve',
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: true,
        rootDirs: ['src', 'generated'],
      },
      include: ['src/*.ts'],
    }),
  );
  writeFileSync(
    path.join(root, 'src/card.ts'),
    `import { Component, NO_ERRORS_SCHEMA } from '@angular/core';\n` +
      `@Component({ selector: 'card', schemas: [NO_ERRORS_SCHEMA], templateUrl: './card.html' })\n` +
      `export class Card {}\n`,
  );
  writeFileSync(path.join(root, 'generated/card.html'), '<text>generated</text>');

  after(async () => {
    await closeNgp();
    rmSync(root, { recursive: true, force: true });
  });

  it('reads a template from where NGP resolved it, and imports that file', async () => {
    const { code, dependencies } = await transformAngularWithNgp(
      readFileSync(path.join(root, 'src/card.ts'), 'utf8'),
      'src/card.ts',
      { projectRoot: root, platform: 'ios', typeCheck: false },
    );
    assert.match(code, /ɵɵtext\(\d+,\s*'generated'\)/);
    assert.deepEqual(dependencies, ['../generated/card.html']);
    assert.match(code, /import "\.\.\/generated\/card\.html";/);
  });

  it('fails a check on a checker that sends what is not JSON, and the next check starts afresh', async () => {
    const restore = env(
      'TSNATIVE_BINARY_PATH',
      fake(
        'broken.js',
        `process.stdin.resume(); process.stdout.write('Content-Length: 5\\r\\n\\r\\nnope!');`,
      ),
    );
    try {
      await assert.rejects(
        transformAngularWithNgp('export const a: number = 1;\n', 'src/a.ts', {
          projectRoot: root,
          platform: 'ios',
        }),
        /type checker sent a message that is not JSON/,
      );
    } finally {
      restore();
    }
    const { code } = await transformAngularWithNgp('export const a: number = 1;\n', 'src/a.ts', {
      projectRoot: root,
      platform: 'ios',
    });
    assert.match(code, /a: number = 1/);
  });

  it('fails a check on a checker that sends JSON that is not an object', async () => {
    const restore = env(
      'TSNATIVE_BINARY_PATH',
      fake(
        'null.js',
        `process.stdin.resume(); process.stdout.write('Content-Length: 4\\r\\n\\r\\nnull');`,
      ),
    );
    const checker = new TsgoChecker(path.join(root, 'tsconfig.json'));
    try {
      await assert.rejects(
        checker.check(path.join(root, 'src/a.ts'), ''),
        /sent a message that is not a JSON object/,
      );
    } finally {
      checker.close();
      restore();
    }
  });

  it('keeps the default deadline for a timeout that is not a positive whole number', async () => {
    const restore = env('ANGULAR_NATIVE_TSGO_TIMEOUT_MS', '-1');
    const checker = new TsgoChecker(path.join(root, 'tsconfig.json'));
    try {
      writeFileSync(path.join(root, 'src/ok.ts'), 'export const ok = 1;\n');
      assert.deepEqual(
        await checker.check(path.join(root, 'src/ok.ts'), 'export const ok = 1;\n'),
        [],
      );
    } finally {
      checker.close();
      restore();
    }
  });

  it('gives up on a checker that never answers', async () => {
    const restoreBinary = env('TSNATIVE_BINARY_PATH', fake('silent.js', 'process.stdin.resume();'));
    const restoreTimeout = env('ANGULAR_NATIVE_TSGO_TIMEOUT_MS', '300');
    const checker = new TsgoChecker(path.join(root, 'tsconfig.json'));
    try {
      await assert.rejects(
        checker.check(path.join(root, 'src/a.ts'), ''),
        /did not answer initialize/,
      );
      assert.ok(checker.exitError);
    } finally {
      checker.close();
      restoreTimeout();
      restoreBinary();
    }
  });
});
