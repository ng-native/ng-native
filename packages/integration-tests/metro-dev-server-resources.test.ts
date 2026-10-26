/**
 * A component's external template or stylesheet edited on its own while a dev server runs.
 *
 * Metro transforms again only the file that changed, and a component's template and sheet are
 * compiled into the component's own module. So after an edit to nothing but `list.html`, a running
 * server went on serving `list.ts` as it was compiled against the old template, to every reload
 * and every relaunch, until `list.ts` itself changed: a touch that kept its text was not enough.
 * Only the template's own module, run first, carried the edit, and wherever that hand-off did not
 * land the app showed the old template.
 *
 * Each case here is a real Metro dev server, `createConnectMiddleware` with its HMR server, on a
 * project of its own: the bundle a device loads is fetched from it over HTTP, run with the real
 * `@angular/core`, and a hot update is taken from its `/hot` socket as a device takes one. Every
 * other package resolves to an empty module.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const expo = path.dirname(require.resolve('expo/package.json'));
const metro = require.resolve('metro', { paths: [expo] });
const Metro = require(metro) as {
  createConnectMiddleware(
    config: object,
    options: object,
  ): Promise<{
    middleware: (req: unknown, res: unknown, next: () => void) => void;
    attachHmrServer(server: Server): void;
    end(): Promise<void>;
  }>;
};
const { FileStore } = require(require.resolve('metro-cache', { paths: [expo] })) as {
  FileStore: new (options: { root: string }) => object;
};
const { resolve } = require(
  require.resolve('metro-resolver', { paths: [path.dirname(metro)] }),
) as {
  resolve(context: object, name: string, platform: string): unknown;
};
const { getDefaultConfig } = require('expo/metro-config') as {
  getDefaultConfig(root: string): Record<string, unknown>;
};
const { withAngularNative } = require('@ng-native/metro/config.cjs') as {
  withAngularNative(config: object): Record<string, unknown>;
};
const { rereadingResources } = require('@ng-native/metro/resource-cache.cjs') as {
  rereadingResources(server: unknown, projectRoot: string): void;
};

const workspace = path.resolve(import.meta.dirname, '../..');
/** What the bundle needs for real to run: Angular, and what Angular and Babel's output import. */
const REAL = /^(?:@angular\/|rxjs(?:\/|$)|tslib$|@babel\/runtime\/)/;

// Real, because Metro watches the project under the path it is given and macOS links the temp
// directory from somewhere else.
const scratch = mkdtempSync(path.join(realpathSync(tmpdir()), 'metro-dev-server-resources-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
let made = 0;

function project(files: Record<string, string>): string {
  const root = path.join(scratch, `app-${made++}`);
  mkdirSync(root);
  write(root, { 'package.json': '{ "name": "app", "private": true }', ...files });
  return root;
}

function write(root: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(root, name), content);
  }
}

type Module = { module: [number, string]; sourceURL: string };
type Update = { added?: Module[]; modified: Module[] };

/** A dev server for `root`, as `npx expo start` runs one, listening on a free port. */
async function devServer(root: string, adjust?: (config: Record<string, unknown>) => void) {
  const config = getDefaultConfig(root);
  // One cache for every case, so only the first transforms Angular.
  config['cacheStores'] = [new FileStore({ root: path.join(scratch, 'cache') })];
  withAngularNative(config);
  adjust?.(config);
  Object.assign(config, {
    reporter: { update() {} },
    resetCache: false,
    maxWorkers: 1,
    watchFolders: [root, workspace],
  });
  const resolver = config['resolver'] as Record<string, unknown>;
  resolver['nodeModulesPaths'] = [
    path.join(import.meta.dirname, 'node_modules'),
    path.join(workspace, 'node_modules'),
    path.join(workspace, 'node_modules/.pnpm/node_modules'),
  ];
  resolver['resolveRequest'] = (context: object, name: string, platform: string) =>
    name.startsWith('.') || path.isAbsolute(name) || REAL.test(name)
      ? resolve({ ...context, resolveRequest: resolve }, name, platform)
      : { type: 'empty' };

  const connect = await Metro.createConnectMiddleware(config, {
    watch: true,
    waitForBundler: true,
  });
  const http = createServer((req, res) =>
    connect.middleware(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  connect.attachHmrServer(http);
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  const { port } = http.address() as { port: number };
  const bundleUrl = `http://127.0.0.1:${port}/index.bundle?platform=ios&dev=true&minify=false`;
  const sockets: WebSocket[] = [];

  return {
    /** The bundle a device loads on a launch or a reload. */
    async bundle(): Promise<string> {
      const response = await fetch(bundleUrl);
      const text = await response.text();
      if (!response.ok) throw new Error(`bundle request failed (${response.status}): ${text}`);
      return text;
    },
    /**
     * A device's `/hot` socket, registered for the bundle: `next(file)` is the next update with that
     * file's module in it (a resource's module is its component's, so `list.html` is `list`). An
     * update for an earlier edit can still arrive while it waits (a watcher may report one write
     * twice), and is skipped.
     */
    async hot(): Promise<{ next(file: string): Promise<Update> }> {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/hot`);
      sockets.push(socket);
      const waiting: ((message: { type: string; body: unknown }) => void)[] = [];
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        for (const listener of [...waiting]) listener(message);
      });
      const until = <T>(pick: (message: { type: string; body: unknown }) => T | undefined) =>
        new Promise<T>((done, fail) => {
          const timer = setTimeout(() => fail(new Error('no message from the HMR server')), 30_000);
          const listener = (message: { type: string; body: unknown }) => {
            const picked = message.type === 'error' ? undefined : pick(message);
            if (message.type !== 'error' && picked === undefined) return;
            clearTimeout(timer);
            waiting.splice(waiting.indexOf(listener), 1);
            if (picked === undefined) fail(new Error(JSON.stringify(message.body)));
            else done(picked);
          };
          waiting.push(listener);
        });
      await new Promise((done) => socket.addEventListener('open', done, { once: true }));
      const registered = until((message) =>
        message.type === 'bundle-registered' ? true : undefined,
      );
      socket.send(JSON.stringify({ type: 'register-entrypoints', entryPoints: [bundleUrl] }));
      await registered;
      return {
        next: (file) =>
          until((message) => {
            if (message.type !== 'update') return undefined;
            const body = message.body as Update;
            const carries = body.modified.some(({ sourceURL }) =>
              new URL(sourceURL).pathname.startsWith(`/${file}.bundle`),
            );
            return carries ? body : undefined;
          }),
      };
    },
    async end(): Promise<void> {
      for (const socket of sockets) socket.close();
      await new Promise((done) => http.close(done));
      await connect.end();
    },
  };
}

/**
 * The bundle run as a device runs it, with the real `@angular/core`: what it logged, the reloads it
 * asked for, and what `List`'s definition holds. `apply` runs a hot update's modules in it.
 */
function launch(bundle: string) {
  const logs: string[] = [];
  const reloads: unknown[] = [];
  const context = vm.createContext({
    console: {
      log: (...args: unknown[]) => logs.push(args.join(' ')),
      warn() {},
      error: (...args: unknown[]) => logs.push(`error ${args.join(' ')}`),
    },
    setTimeout,
    clearTimeout,
    queueMicrotask,
    performance,
    __angularNativeReload: (file: unknown) => reloads.push(file),
  });
  context['globalThis'] = context;
  context['global'] = context;
  vm.runInContext(bundle, context);
  return {
    logs,
    reloads,
    /** What `List` renders, as the constants its compiled template reads. */
    shown(): string {
      type Defined = { ɵcmp?: { consts?: unknown }; ɵnativeStyles?: unknown };
      const registry = context['__angularNativeHmr'] as Map<
        string,
        { types: Map<string, Defined> }
      >;
      const type = registry.get('list.ts')?.types.get('list.ts@List');
      return JSON.stringify([type?.ɵcmp?.consts, type?.ɵnativeStyles ?? null]);
    },
    apply(update: Update): void {
      for (const { module } of [...(update.added ?? []), ...update.modified]) {
        vm.runInContext(module[1], context);
      }
    },
  };
}

const list = (decorator: string) => `import { Component } from '@angular/core';
@Component({ selector: 'app-list', ${decorator} })
export class List {}
`;
/** `List`, reading a plain module of the project, `helper.ts`. */
const LIST_WITH_HELPER = (
  decorator: string,
  members: string,
) => `import { Component } from '@angular/core';
import { label } from './helper';
@Component({ selector: 'app-list', ${decorator} })
export class List {
  label = label;
  ${members}
}
`;
const INDEX = `import { List } from './list';\nexport default List;\n`;

describe('a running dev server, after an edit to only an external template or stylesheet', () => {
  it('serves the component built with the edited templateUrl on the next launch', async () => {
    const root = project({
      'index.ts': INDEX,
      'list.ts': list(`templateUrl: './list.html'`),
      'list.html': '<native-header title="FIRST_TITLE" />',
    });
    const server = await devServer(root);
    try {
      assert.match(launch(await server.bundle()).shown(), /FIRST_TITLE/);

      write(root, { 'list.html': '<native-header title="SECOND_TITLE" />' });
      const app = launch(await settled(server, ['SECOND_TITLE'], ['FIRST_TITLE']));
      assert.match(app.shown(), /SECOND_TITLE/);
      assert.deepEqual(app.reloads, []);
    } finally {
      await server.end();
    }
  });

  it('serves the components built with an edited styleUrl and one of their styleUrls', async () => {
    const root = project({
      'index.ts': `import './other';\n${INDEX}`,
      'list.ts': list(`template: '<view class="list"></view>', styleUrl: './list.css'`),
      'other.ts': `import { Component } from '@angular/core';
@Component({ selector: 'app-other', template: '<view class="base"></view>', styleUrls: ['./base.css', './other.css'] })
export class Other {}
`,
      'list.css': '.list-first { opacity: 0.5 }',
      'base.css': '.base { opacity: 0.5 }',
      'other.css': '.other-first { opacity: 0.25 }',
    });
    const server = await devServer(root);
    try {
      const before = await server.bundle();
      assert.ok(before.includes('list-first') && before.includes('other-first'));

      write(root, {
        'list.css': '.list-second { opacity: 0.5 }',
        'other.css': '.other-second { opacity: 0.25 }',
      });
      const bundle = await settled(
        server,
        ['list-second', 'other-second'],
        ['list-first', 'other-first'],
      );
      assert.ok(
        bundle.includes('"base"'),
        'the stylesheet that did not change is still in the sheet',
      );
      assert.match(launch(bundle).shown(), /list-second/);
    } finally {
      await server.end();
    }
  });

  it('hot-swaps the edited template on a live app, with the component module carrying it too', async () => {
    const root = project({
      'index.ts': INDEX,
      'list.ts': list(`templateUrl: './list.html'`),
      'list.html': '<native-header title="FIRST_TITLE" />',
    });
    const server = await devServer(root);
    try {
      const app = launch(await server.bundle());
      const hot = await server.hot();

      write(root, { 'list.html': '<native-header title="SECOND_TITLE" />' });
      const update = await hot.next('list');
      const carried = update.modified.map(({ module }) => module[1]);
      assert.ok(
        carried.some(
          (code) => code.includes('var file = "list.ts"') && code.includes('SECOND_TITLE'),
        ),
        "the component's own module is in the update, built with the edit",
      );
      app.apply(update);
      assert.match(app.shown(), /SECOND_TITLE/);
      assert.deepEqual(app.reloads, [], 'swapped where it is, with no reload asked for');
      assert.deepEqual(
        app.logs.filter((line) => line.startsWith('error')),
        [],
      );
    } finally {
      await server.end();
    }
  });

  it('reloads for an edit to a module the component imports, after a template swap', async () => {
    const root = project({
      'index.ts': INDEX,
      'list.ts': LIST_WITH_HELPER(`templateUrl: './list.html'`, ''),
      'list.html': '<native-header title="FIRST_TITLE" />',
      'helper.ts': `export const label = 'first';\n`,
    });
    const server = await devServer(root);
    try {
      const app = launch(await server.bundle());
      const hot = await server.hot();

      write(root, { 'list.html': '<native-header title="SECOND_TITLE" />' });
      app.apply(await hot.next('list'));
      assert.match(app.shown(), /SECOND_TITLE/);
      assert.deepEqual(app.reloads, []);

      write(root, { 'helper.ts': `export const label = 'second';\n` });
      app.apply(await hot.next('helper'));
      assert.deepEqual(app.reloads, ['list.ts'], 'the swap kept the resources it applied');
      assert.ok(app.logs.includes('[angular-native] hmr reload: a dependency changed list.ts'));
    } finally {
      await server.end();
    }
  });

  it('reloads for an edit to a module the component imports, after a class patch that moved its template', async () => {
    const root = project({
      'index.ts': INDEX,
      'list.ts': LIST_WITH_HELPER(`templateUrl: './list.html'`, ''),
      'list.html': '<native-header title="FIRST_TITLE" />',
      'items.html': '<native-header title="ITEMS_TITLE" />',
      'helper.ts': `export const label = 'first';\n`,
    });
    const server = await devServer(root);
    try {
      const app = launch(await server.bundle());
      const hot = await server.hot();

      write(root, {
        'list.ts': LIST_WITH_HELPER(`templateUrl: './items.html'`, 'count() { return 1; }'),
      });
      app.apply(await hot.next('list'));
      assert.deepEqual(app.reloads, [], 'the new method is patched onto the live class');

      write(root, { 'helper.ts': `export const label = 'second';\n` });
      app.apply(await hot.next('helper'));
      assert.deepEqual(app.reloads, ['list.ts'], 'the patch kept the resources it applied');
      assert.ok(app.logs.includes('[angular-native] hmr reload: a dependency changed list.ts'));
    } finally {
      await server.end();
    }
  });

  it('fails the bundle once the template is deleted, and builds it again once it is back', async () => {
    const root = project({
      'index.ts': INDEX,
      'list.ts': list(`templateUrl: './list.html'`),
      'list.html': '<native-header title="FIRST_TITLE" />',
    });
    const server = await devServer(root);
    try {
      await server.bundle();

      unlinkSync(path.join(root, 'list.html'));
      await waitFor(async () => {
        try {
          await server.bundle();
          return false;
        } catch (error) {
          return /list\.html/.test(String(error));
        }
      }, 'the bundle fails, naming the template it cannot read');

      write(root, { 'list.html': '<native-header title="THIRD_TITLE" />' });
      const bundle = await settled(server, ['THIRD_TITLE'], ['FIRST_TITLE']);
      assert.match(launch(bundle).shown(), /THIRD_TITLE/);
    } finally {
      await server.end();
    }
  });

  it('builds the component again when its own file changes, the template moved to another file', async () => {
    const root = project({
      'index.ts': INDEX,
      'list.ts': list(`templateUrl: './list.html'`),
      'list.html': '<native-header title="FIRST_TITLE" />',
    });
    const server = await devServer(root);
    try {
      await server.bundle();

      write(root, {
        'items.html': '<native-header title="RENAMED_TITLE" />',
        'list.ts': list(`templateUrl: './items.html'`),
      });
      unlinkSync(path.join(root, 'list.html'));
      const app = launch(await settled(server, ['RENAMED_TITLE'], ['FIRST_TITLE']));
      assert.match(app.shown(), /RENAMED_TITLE/);
      assert.deepEqual(app.reloads, []);
    } finally {
      await server.end();
    }
  });
});

type Enhance = (middleware: unknown, server: unknown) => unknown;
type DeltaBundler = { getDelta(...args: unknown[]): unknown; _deltaCalculators?: unknown };

/**
 * The dev server's config, with `_deltaCalculators` gone from the delta bundler for what reads it
 * on the way into `getDelta` from outside Metro, as on a Metro that renamed it. Metro's own
 * `getDelta`, and everything else in Metro, still reads it.
 */
function withoutCalculators(config: Record<string, unknown>): void {
  const server = config['server'] as { enhanceMiddleware: Enhance };
  const enhance = server.enhanceMiddleware;
  server.enhanceMiddleware = (middleware, metroServer) => {
    const delta = (metroServer as { getBundler(): { getDeltaBundler(): DeltaBundler } })
      .getBundler()
      .getDeltaBundler();
    let calculators = delta._deltaCalculators;
    let hidden = false;
    Object.defineProperty(delta, '_deltaCalculators', {
      configurable: true,
      get: () => (hidden ? undefined : calculators),
      set: (value) => {
        calculators = value;
      },
    });
    const metroGetDelta = delta.getDelta;
    delta.getDelta = function (...args) {
      hidden = false;
      return metroGetDelta.apply(this, args);
    };
    const enhanced = enhance(middleware, metroServer);
    const wrapped = delta.getDelta;
    delta.getDelta = function (...args) {
      hidden = true;
      return wrapped.apply(this, args);
    };
    return enhanced;
  };
}

/** A Metro server as `rereadingResources` reaches it, with only the members given. */
function fakeServer(delta: object, bundler: object) {
  return { getBundler: () => ({ getDeltaBundler: () => delta, getBundler: () => bundler }) };
}

describe('a dev server on a Metro without the internals that say what changed', () => {
  it('still builds the bundle, and says once that a template edit may not show', async () => {
    const root = project({
      'index.ts': INDEX,
      'list.ts': list(`templateUrl: './list.html'`),
      'list.html': '<native-header title="FIRST_TITLE" />',
    });
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(' '));
    };
    const server = await devServer(root, withoutCalculators);
    try {
      assert.match(launch(await server.bundle()).shown(), /FIRST_TITLE/);
      write(root, { 'list.html': '<native-header title="SECOND_TITLE" />' });
      // The template's own module still carries the edit; the component's is left as it was.
      await settled(server, ['SECOND_TITLE'], []);
    } finally {
      console.warn = warn;
      await server.end();
    }
    assert.deepEqual(
      warnings.filter((line) => line.includes('does not say which files changed')).length,
      1,
    );
  });

  it('leaves a Metro without getDelta or transformFile as it is', () => {
    const getDelta = () => 'delta';
    const transformFile = async () => ({});
    const withoutTransform = { getDelta };
    rereadingResources(fakeServer(withoutTransform, {}), '/');
    assert.equal(withoutTransform.getDelta, getDelta);

    const bundler = { transformFile };
    rereadingResources(fakeServer({}, bundler), '/');
    assert.equal(bundler.transformFile, transformFile);

    assert.doesNotThrow(() => rereadingResources(undefined, '/'));
    assert.doesNotThrow(() => rereadingResources({}, '/'));
  });

  it('hands getDelta on unchanged when the calculator has no set of changed files', () => {
    const graph = { dependencies: new Map() };
    const seen: unknown[][] = [];
    const delta: DeltaBundler = {
      _deltaCalculators: new Map([[graph, { _modifiedFiles: [] }]]),
      getDelta(...args) {
        seen.push([this, ...args]);
        return 'delta';
      },
    };
    const warn = console.warn;
    let warned = 0;
    console.warn = () => {
      warned++;
    };
    try {
      rereadingResources(fakeServer(delta, { transformFile: async () => ({}) }), '/');
      assert.equal(delta.getDelta(graph, { reset: true }), 'delta');
      assert.equal(delta.getDelta(graph, { reset: false }), 'delta');
    } finally {
      console.warn = warn;
    }
    assert.equal(warned, 1);
    assert.deepEqual(seen, [
      [delta, graph, { reset: true }],
      [delta, graph, { reset: false }],
    ]);
  });

  it('wraps a server once, however many times it is handed over', async () => {
    const calls: string[] = [];
    const delta: DeltaBundler = {
      _deltaCalculators: new Map(),
      getDelta: () => calls.push('getDelta'),
    };
    const bundler = {
      transformFile: async () => {
        calls.push('transformFile');
        return { output: [{ data: { angularNativeResources: [] } }] };
      },
    };
    const server = fakeServer(delta, bundler);
    rereadingResources(server, '/');
    const getDelta = delta.getDelta;
    const transformFile = bundler.transformFile;
    rereadingResources(server, '/');
    assert.equal(delta.getDelta, getDelta);
    assert.equal(bundler.transformFile, transformFile);
    await bundler.transformFile();
    assert.deepEqual(calls, ['transformFile']);
  });
});

/**
 * The server's bundle, once every module in it has the edit: the text in `has`, and none of the
 * text the edit replaced in `lacks`. Metro hears of a file change on its own clock, so it is asked
 * until then, and a module still built from the old text fails the case.
 */
async function settled(
  server: { bundle(): Promise<string> },
  has: string[],
  lacks: string[],
): Promise<string> {
  let last = '';
  await waitFor(
    async () => {
      try {
        last = await server.bundle();
      } catch (error) {
        last = String(error);
        return false;
      }
      return has.every((text) => last.includes(text)) && !lacks.some((text) => last.includes(text));
    },
    () =>
      `every module has ${has.join(', ')} and none ${lacks.join(', ')}; still there: ` +
      `${lacks.filter((text) => last.includes(text)).join(', ') || 'none'}, missing: ` +
      `${has.filter((text) => !last.includes(text)).join(', ') || 'none'}`,
  );
  return last;
}

async function waitFor(
  check: () => Promise<boolean>,
  what: string | (() => string),
): Promise<void> {
  for (const started = Date.now(); Date.now() - started < 20_000;) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.fail(`timed out waiting until ${typeof what === 'string' ? what : what()}`);
}
