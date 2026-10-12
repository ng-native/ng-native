/**
 * The build half of `<dom-component>`: an ordinary Angular component for the browser, compiled by the same
 * Metro that builds the app, and shipped the way Expo ships its own DOM components.
 *
 * A DOM component is a file that starts with `'use dom'` and calls `mountInWebView`. Imported from native code it is not
 * compiled at all: it becomes a reference to its page, carrying the same metadata Expo's `'use dom'`
 * plugin records, so Expo's dev server serves the page and `expo export:embed` writes it into the
 * app for a release build. Built for the web, it is compiled with its CSS left for the browser, and
 * the page's entry loads it directly rather than through Expo's React root.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { measureCpu } from './measure-cpu.ts';

const require = createRequire(import.meta.url);
const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');
const { isAngularDomComponent, domComponentEntry } = require('@ng-native/metro/dom-component.cjs');

const STYLED = `
import { Component } from '@angular/core';
@Component({
  selector: 'app-note',
  template: '<textarea></textarea>',
  styles: ['textarea { resize: vertical; caret-color: red; }'],
})
export class Note {}
`;

const WEB_COMPONENT = `'use dom';
import { Component } from '@angular/core';
import { mountInWebView } from '@ng-native/web/web-view';

@Component({ selector: 'app-note', template: '<textarea></textarea>' })
export class Note {}

export default mountInWebView(Note);
`;

describe('an Angular component compiled for the web', () => {
  it('keeps its styles for the browser, in a release build too', () => {
    const { code } = transformAngular(STYLED, '/app/note.ts', { platform: 'web' });
    assert.match(code, /resize:\s*vertical/, 'the CSS is in the definition');
  });

  it('does not compile them for native, which would drop what only a browser has', () => {
    // `resize` has no native equivalent: on native it is dropped with a warning, on the web it is
    // CSS, and the web build says nothing about it.
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (message: string) => void warnings.push(message);
    try {
      const { code } = transformAngular(STYLED, '/app/note.ts', { platform: 'web', dev: true });
      assert.doesNotMatch(code, /ɵnativeStyles/);
      assert.deepEqual(warnings, []);
      transformAngular(STYLED, '/app/note.ts', {});
    } finally {
      console.warn = warn;
    }
    assert.match(warnings.join('\n'), /dropped 'resize'/);
  });

  it("leaves out native's hot update, which reaches for the native renderer", () => {
    const { code } = transformAngular(STYLED, '/app/note.ts', { platform: 'web', dev: true });
    assert.doesNotMatch(code, /ɵnativeStyles|__angularNativeHmr/);
  });
});

describe("recognising an Angular DOM component: 'use dom' and mountInWebView", () => {
  const mounts = '\nexport default mountInWebView(Note);';

  it('reads past comments to the first statement', () => {
    assert.equal(isAngularDomComponent("// note\n/* more */\n'use dom';" + mounts), true);
    assert.equal(isAngularDomComponent('"use dom"' + mounts), true);
    assert.equal(
      isAngularDomComponent("import x from 'y';\n'use dom';" + mounts),
      false,
      'first only',
    );
  });

  it("leaves Expo's own React DOM components to Expo", () => {
    // The same directive: what makes a file ours is that Angular mounts it.
    assert.equal(isAngularDomComponent("'use dom';\nexport default function Chart() {}"), false);
    assert.equal(isAngularDomComponent("'use client';" + mounts), false);
  });

  it('answers at once for an ordinary file, however it starts', () => {
    // Every file in the app is asked. A backtracking pattern once hung the bundler on these.
    const inputs = [
      ' \n'.repeat(50_000) + 'export const a = 1;',
      '/**\n' + ' * line\n'.repeat(50_000) + ' */\nexport const a = 1;',
      '/* never closed ' + ' '.repeat(50_000),
    ];
    for (const input of inputs) assert.equal(isAngularDomComponent(input), false);
    const ms = measureCpu(
      require.resolve('@ng-native/metro/dom-component.cjs'),
      'for (const source of input) subject.isAngularDomComponent(source);',
      inputs,
    );
    assert.ok(ms < 200, `linear, not exponential: took ${Math.round(ms)}ms of CPU`);
  });
});

describe('a DOM component imported from native code', () => {
  const transformer = require('@ng-native/metro/transformer.cjs') as {
    transform(params: {
      filename: string;
      src: string;
      options: { dev: boolean; platform: string };
      plugins: unknown[];
    }): { ast: object; metadata?: { expoDomComponentReference?: string } };
  };
  const generate = (require('@babel/generator') as { default: Function }).default;
  const filename = '/repo/app/web/note.ts';
  const reference = pathToFileURL(filename).href;

  function build(dev: boolean, platform = 'ios') {
    const result = transformer.transform({
      filename,
      src: WEB_COMPONENT,
      options: { dev, platform },
      plugins: [],
    });
    return { code: generate(result.ast).code as string, metadata: result.metadata };
  }

  it('is a reference to its page, not the component: none of it runs on native', () => {
    const { code } = build(true);
    assert.doesNotMatch(code, /ɵɵdefineComponent|platform-browser|mountInWebView/);
    assert.match(code, /domComponent/);
  });

  it('is the component itself in the web build of its page', () => {
    const { code, metadata } = build(false, 'web');
    assert.match(code, /ɵɵdefineComponent/);
    assert.equal(metadata?.expoDomComponentReference, undefined);
  });

  it("names the page as Expo's dev server serves a DOM component's", () => {
    assert.match(build(true).code, /"note\.ts\?file=file:\/\/\/repo\/app\/web\/note\.ts"/);
  });

  it('names it as `expo export:embed` writes it into a release build', () => {
    const md5 = createHash('md5').update(reference).digest('hex');
    assert.match(build(false).code, new RegExp(`"${md5}\\.html"`));
  });

  it("records the file the way Expo's 'use dom' plugin does, which is how the export finds it", () => {
    assert.equal(build(false).metadata?.expoDomComponentReference, reference);
  });
});

describe("the page's entry", () => {
  /** Our worker in front of a stand-in for Expo's, whose inner worker hands back the source. */
  function worker() {
    const root = mkdtempSync(path.join(tmpdir(), 'ng-native-web-entry-'));
    const dir = path.join(root, 'node_modules/@expo/metro-config/build/transform-worker');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'transform-worker.js'),
      'module.exports = { transform: () => "expo" };',
    );
    writeFileSync(
      path.join(dir, 'metro-transform-worker.js'),
      'module.exports = { transform: (c, p, f, data) => data.toString() };',
    );
    const entry = path.join(root, 'node_modules/expo/dom/entry.js');
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(path.join(root, 'note.ts'), WEB_COMPONENT);
    writeFileSync(path.join(root, 'react.tsx'), "'use dom';\nexport default function A() {}\n");
    const ours = require('@ng-native/metro/transform-worker.cjs') as {
      transform(...args: unknown[]): string;
    };
    const config = {
      angularNativeUpstreamTransformer: path.relative(root, path.join(dir, 'transform-worker.js')),
    };
    const run = (dom: string) =>
      ours.transform(config, root, entry, Buffer.from(''), {
        platform: 'web',
        customTransformOptions: { dom: encodeURI(dom) },
      });
    return { run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  it('loads a DOM component directly, with no React root', () => {
    const { run, cleanup } = worker();
    try {
      const source = run('../../../note.ts');
      assert.match(source, /require\("\.\.\/\.\.\/\.\.\/note\.ts"\)/);
      assert.doesNotMatch(source, /registerDOMComponent/);
    } finally {
      cleanup();
    }
  });

  it("leaves Expo's own DOM components to Expo", () => {
    const { run, cleanup } = worker();
    try {
      assert.equal(run('../../../react.tsx'), 'expo');
    } finally {
      cleanup();
    }
  });

  it('reports an error thrown before Angular is up, which nothing else would catch', () => {
    // A failed import or a module that throws as it loads never reaches Angular's ErrorHandler,
    // and a web view's own console is in Safari's inspector: the page has to pass it on itself.
    const posted: string[] = [];
    const listeners: Record<string, (event: unknown) => void> = {};
    const window = {
      ReactNativeWebView: { postMessage: (data: string) => posted.push(data) },
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        (listeners[type] = listener),
    };
    const loaded: string[] = [];
    new Function('window', 'require', domComponentEntry('./note.ts'))(window, (id: string) =>
      loaded.push(id),
    );
    assert.deepEqual(loaded, ['./note.ts'], 'and then loads the component');

    listeners['error']!({ message: 'boom', error: new Error('boom') });
    listeners['unhandledrejection']!({ reason: new Error('rejected') });
    assert.deepEqual(
      posted.map((data) => JSON.parse(data)).map((m) => [m.type, m.message.split('\n')[0]]),
      [
        ['error', 'boom'],
        ['error', 'rejected'],
      ],
    );
  });
});

describe("the files a page's stylesheet names, in a release build", () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  const md5 = (data: Buffer) => createHash('md5').update(data).digest('hex');

  /** Our worker in front of Expo's own, over a project with a stylesheet and files beside it. */
  function project(css: string, files: Record<string, Buffer> = {}, sheet = 'web/page.css') {
    const root = mkdtempSync(path.join(tmpdir(), 'ng-native-page-css-'));
    for (const [name, data] of Object.entries({ [sheet]: Buffer.from(css), ...files })) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), data);
    }
    const expo = createRequire(require.resolve('expo/package.json')).resolve(
      '@expo/metro-config/build/transform-worker/transform-worker.js',
    );
    const ours = require('@ng-native/metro/transform-worker.cjs') as {
      transform(...args: unknown[]): Promise<Sheet>;
    };
    const config = {
      angularNativeUpstreamTransformer: path.relative(root, expo),
      angularNativeAssetExts: ['png', 'woff2'],
      assetPlugins: [],
      publicPath: '/assets',
    };
    const warnings: string[] = [];
    const transform = (options: object = {}) =>
      ours.transform(config, root, sheet, Buffer.from(css), {
        platform: 'web',
        dev: false,
        type: 'module',
        customTransformOptions: { dom: './p.ts' },
        ...options,
      });
    const run = async (options: object = {}) => {
      const warn = console.warn;
      console.warn = (message: unknown) => warnings.push(String(message));
      try {
        const sheet = await transform(options);
        return {
          css: sheet.output[0]!.data.css?.code ?? '',
          dependencies: sheet.dependencies.map((dependency) => dependency.name),
          resources: (sheet.angularNativeResources ?? []).map((resource) => resource.file),
        };
      } finally {
        console.warn = warn;
      }
    };
    return {
      run,
      transform,
      warnings,
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
  }

  it('are in the bundle, and the url()s point at where the export writes them', async () => {
    const font = Buffer.from('a font');
    const { run, warnings, cleanup } = project(
      `.a { background: url('./pic.png'); }
       @font-face { font-family: F; src: url("fonts/f.woff2?v=1#x") format('woff2'); }`,
      { 'web/pic.png': PNG, 'web/fonts/f.woff2': font },
    );
    try {
      const sheet = await run();
      // From `www.bundle/_expo/static/css`, to the name and the hash Expo's export gives a file.
      assert.match(
        sheet.css,
        new RegExp(`url\\("\\.\\./\\.\\./\\.\\./assets/web/pic\\.${md5(PNG)}\\.png"\\)`),
      );
      assert.ok(
        sheet.css.includes(`url("../../../assets/web/fonts/f.${md5(font)}.woff2?v=1#x")`),
        sheet.css,
      );
      assert.deepEqual(sheet.dependencies.slice(-2), ['./pic.png', './fonts/f.woff2']);
      assert.deepEqual(warnings, [], "and Expo's warning that they are not supported is not said");
      // The sheet holds each file's hash, so a cached transform is stale once a file changes.
      assert.deepEqual(sheet.resources, ['web/pic.png', 'web/fonts/f.woff2']);
    } finally {
      cleanup();
    }
  });

  it('leaves alone what is not a file beside the sheet', async () => {
    const css = `.a { background: url(data:image/png;base64,AAAA), url(https://example.com/a.png), url(/a.png), url(#a); }`;
    const { run, cleanup } = project(css);
    try {
      const sheet = await run();
      for (const url of [
        'data:image/png;base64,AAAA',
        'https://example.com/a.png',
        '/a.png',
        '#a',
      ]) {
        assert.ok(sheet.css.includes(`url("${url}")`), `${url} in ${sheet.css}`);
      }
      assert.deepEqual(sheet.resources, []);
    } finally {
      cleanup();
    }
  });

  it('leaves a file that is missing, or that Metro would not take as an asset, with a warning', async () => {
    const { run, warnings, cleanup } = project(
      `.a { background: url('./gone.png'), url('./notes.txt'), url('./pic.png'); }`,
      { 'web/notes.txt': Buffer.from('notes'), 'web/pic.png': PNG },
    );
    try {
      const sheet = await run();
      assert.ok(
        sheet.css.includes('url("./gone.png")') && sheet.css.includes('url("./notes.txt")'),
      );
      assert.deepEqual(sheet.dependencies.slice(-1), ['./pic.png'], 'the one that can be is');
      assert.equal(warnings.length, 3, 'as Expo said it');
      assert.match(warnings[0]!, /not supported yet/);
    } finally {
      cleanup();
    }
  });

  it('says the warning of one sheet while another, transformed with it, has none to say', async () => {
    // Metro without workers transforms files together in one process, and `console.warn` is one.
    const fine = project(`.a { background: url('./pic.png'); }`, { 'web/pic.png': PNG });
    const broken = project(`.a { background: url('./gone.png'); }`, {}, 'web/other.css');
    const said: string[] = [];
    const warn = console.warn;
    console.warn = (message: unknown) => said.push(String(message));
    try {
      await Promise.all([fine.transform(), broken.transform()]);
      assert.equal(said.length, 1, said.join('\n'));
      assert.match(said[0]!, /gone\.png/);
      const mine = console.warn;
      assert.equal((console.warn('after'), said.at(-1)), 'after', 'console.warn is put back');
      assert.equal(console.warn, mine);
    } finally {
      console.warn = warn;
      fine.cleanup();
      broken.cleanup();
    }
  });

  it('are left to Metro in development, and in a page that is not a DOM component', async () => {
    const { run, cleanup } = project(`.a { background: url('./pic.png'); }`, {
      'web/pic.png': PNG,
    });
    try {
      assert.deepEqual((await run({ dev: true })).resources, []);
      const web = await run({ customTransformOptions: {} });
      assert.ok(web.css.includes('url("./pic.png")'), web.css);
    } finally {
      cleanup();
    }
  });
});

interface Sheet {
  dependencies: { name: string }[];
  output: { data: { css?: { code: string } } }[];
  angularNativeResources?: { file: string }[];
}
