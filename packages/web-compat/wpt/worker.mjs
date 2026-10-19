/**
 * The process the tests run in, started by `run.mjs` with the files to run. For each file: an
 * app with `provideWebCompat()` is brought up, the page is built in its document, its scripts
 * are run with `testharness.js`, and what the harness reports is sent back.
 *
 * A test's scripts run in this realm, as they must: they are handed the engine's own nodes, and
 * an error thrown by one is compared with this realm's `TypeError`. So what a file leaves behind
 * is taken away after it: the globals it added, the ones it changed, what it changed on their
 * prototypes, its timers and its page.
 *
 * An iframe is the emulated frame document (`frames: 'emulated'`), whose document a test reads
 * as one of its own origin. Its `src` in the checkout is read from it as WPT's server serves the
 * file (see `loadFrame`), and the page's `load` waits for its frames, as a browser's does.
 *
 * SHIMS. What the harness cannot run without and the package does not have. Each is a gap:
 * - `self` and `parent`, both the global object.
 * The `DOMContentLoaded` a browser sends the document, and the `load`, `error` and
 * `unhandledrejection` it sends the window, are sent through the package's own, and `onload` and
 * `onerror` are called.
 * `GLOBAL` and `META_TITLE`, which a `.any.js` test reads, are the test server's to define and
 * are defined here as it does.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';
import { cleanup, render } from '@ng-native/testing';
import { PlatformLocation } from '@angular/common';
import { provideWebCompat } from '../src/index.ts';
import { layOutFabric } from '../../integration-tests/laid-out-fabric.ts';
import { Page } from './host.ts';
import { CHECKOUT } from './pin.mjs';
import { buildPage } from './page.mjs';
import { inCheckout, isReport, metaOf, resolveScript } from './tests.mjs';

/**
 * A module of the package that is not there in every version of it: the address a page is at
 * and its frames come in later than the rest. Where it is not there, what it would give is
 * left out and the tests that need it fail, which the expectations record.
 */
async function optional(path) {
  const url = new URL(path, import.meta.url);
  return existsSync(url) ? import(url.href) : {};
}
const { StillLocation } = await optional('../src/location.ts');
const { framesLoaded, framesLoading } = await optional('../src/frame.ts');

const HARNESS = 'resources/testharness.js';
const WINDOW = { width: 800, height: 600, colorScheme: 'light' };
/** Where WPT's own server is, which the tests' URLs are written for. */
const ORIGIN = 'http://web-platform.test:8000';
/** What WPT's server says a file is, by its extension. */
const TYPES = {
  html: 'text/html',
  htm: 'text/html',
  xhtml: 'application/xhtml+xml',
  xht: 'application/xhtml+xml',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  css: 'text/css',
  js: 'text/javascript',
  png: 'image/png',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  bmp: 'image/bmp',
};

/**
 * What an iframe's `src` is, served as WPT's server serves a file of the checkout: by its
 * extension, or the type its `.headers` file says. What the server makes by a script, a `.py`
 * or a `.sub` file it fills in, is not served.
 */
function loadFrame(url) {
  if (!url.startsWith(`${ORIGIN}/`)) return undefined;
  const path = decodeURIComponent(new URL(url).pathname.slice(1));
  if (/\.py$|\.sub\./.test(path)) return undefined;
  const file = inCheckout(path);
  if (!file || !existsSync(file) || !statSync(file).isFile()) return undefined;
  const headers = existsSync(`${file}.headers`) ? readFileSync(`${file}.headers`, 'utf8') : '';
  const said = /^content-type:\s*(.+)$/im.exec(headers)?.[1]?.trim();
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const contentType = said ?? TYPES[extension] ?? 'application/octet-stream';
  return { body: readFileSync(file, 'utf8'), contentType, url };
}

const real = { setTimeout, clearTimeout, setInterval, clearInterval };
const delay = (ms) => new Promise((resolve) => real.setTimeout(resolve, ms));
const describe = (error) =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/**
 * A script with the `let`, `const` and `class` at its top level made `var`: they are then
 * properties of the global object, which the next script of the page reads as it would in a
 * browser, and which can be deleted once the file is over. Left as they are, they would be kept
 * by the realm for good, and the next file to declare the same name would not parse.
 *
 * `strict` is whether the script says `'use strict'` for the whole of itself: see `evaluate`.
 */
function hoist(code) {
  const file = ts.createSourceFile(
    'script.js',
    code,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const edits = [];
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      const list = statement.declarationList;
      const start = list.getStart(file);
      if (list.flags & ts.NodeFlags.Const) edits.push([start, start + 5, 'var']);
      else if (list.flags & ts.NodeFlags.Let) edits.push([start, start + 3, 'var']);
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      const start = statement.getStart(file);
      edits.push([statement.end, statement.end, ';']);
      edits.push([start, start, `var ${statement.name.text} = `]);
    }
  }
  let out = code;
  for (const [from, to, text] of edits.sort((a, b) => b[0] - a[0] || b[1] - a[1])) {
    out = out.slice(0, from) + text + out.slice(to);
  }
  const first = file.statements[0];
  const strict =
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use strict';
  return { code: out, strict };
}

/** Scripts from the checkout as they are run, by path: the harness is read for every file. */
const loaded = new Map();
function scriptAt(path) {
  let script = loaded.get(path);
  if (script === undefined) {
    const file = inCheckout(path);
    if (!file) throw new Error(`${path} is outside the checkout`);
    script = hoist(readFileSync(file, 'utf8'));
    loaded.set(path, script);
  }
  return script;
}

/** The global object's own properties as they are now, to put back. */
const snapshot = () => Object.getOwnPropertyDescriptors(globalThis);

const same = (a, b) => a.value === b.value && a.get === b.get && a.set === b.set;

/** Take away what was added to the global object since a snapshot, and put back what changed. */
function restore(before) {
  for (const name of Reflect.ownKeys(globalThis)) {
    const had = Object.hasOwn(before, name) ? before[name] : undefined;
    const has = Object.getOwnPropertyDescriptor(globalThis, name);
    try {
      if (!had && !Reflect.deleteProperty(globalThis, name)) globalThis[name] = undefined;
      else if (had && has && !same(had, has)) Object.defineProperty(globalThis, name, had);
    } catch {
      // Not configurable and not writable: it is there until the process is replaced.
    }
  }
  for (const name of Reflect.ownKeys(before)) {
    if (!Object.hasOwn(globalThis, name)) Object.defineProperty(globalThis, name, before[name]);
  }
}

/**
 * The prototypes of the global classes as they are now, to put back: a test that tampers with
 * one, `NodeList.prototype.length` say, tampers with it for every file after it in the process,
 * where a browser gives each page its own.
 */
function snapshotPrototypes() {
  const kept = new Map();
  for (const name of Reflect.ownKeys(globalThis)) {
    const value = Object.getOwnPropertyDescriptor(globalThis, name)?.value;
    const prototype = typeof value === 'function' ? value.prototype : undefined;
    if (prototype && typeof prototype === 'object' && !kept.has(prototype)) {
      kept.set(prototype, Object.getOwnPropertyDescriptors(prototype));
    }
  }
  return kept;
}

function restorePrototypes(kept) {
  for (const [prototype, before] of kept) {
    for (const name of Reflect.ownKeys(prototype)) {
      // Its own: what it holds is a plain object, which a test that adds to `Object.prototype`
      // gives the same name, and what the test added would be kept.
      const had = Object.hasOwn(before, name) ? before[name] : undefined;
      const has = Object.getOwnPropertyDescriptor(prototype, name);
      try {
        if (!had) Reflect.deleteProperty(prototype, name);
        else if (has && !same(had, has)) Object.defineProperty(prototype, name, had);
      } catch {
        // Not configurable: it stays as the test left it.
      }
    }
    for (const name of Reflect.ownKeys(before)) {
      if (!Object.hasOwn(prototype, name)) Object.defineProperty(prototype, name, before[name]);
    }
  }
}

/** Timers a file starts, to stop when it is over: a late one would call into the next file. */
function trackTimers() {
  const timeouts = new Set();
  const intervals = new Set();
  globalThis.setTimeout = (...args) => {
    const id = real.setTimeout(...args);
    timeouts.add(id);
    return id;
  };
  globalThis.setInterval = (...args) => {
    const id = real.setInterval(...args);
    intervals.add(id);
    return id;
  };
  return () => {
    for (const id of timeouts) real.clearTimeout(id);
    for (const id of intervals) real.clearInterval(id);
    globalThis.setTimeout = real.setTimeout;
    globalThis.setInterval = real.setInterval;
  };
}

/** The shims: see the head of this file. Answers what takes them away. */
function shimWindow() {
  const shims = { self: globalThis, parent: globalThis };
  const added = Object.keys(shims).filter((name) => !(name in globalThis));
  for (const name of added) {
    Object.defineProperty(globalThis, name, {
      value: shims[name],
      writable: true,
      configurable: true,
    });
  }
  return () => {
    for (const name of added) delete globalThis[name];
  };
}

const TEST_STATUS = ['PASS', 'FAIL', 'TIMEOUT', 'NOTRUN', 'PRECONDITION_FAILED'];
const FILE_STATUS = ['OK', 'ERROR', 'TIMEOUT', 'PRECONDITION_FAILED'];
const short = (message) => (message == null ? null : String(message).slice(0, 400));

/** One file being run. */
class FileRun {
  constructor(path, limit) {
    this.path = path;
    this.limit = limit;
    /** Subtests as each finished, for a file whose harness never completes. */
    this.finished = [];
    /** Steps of the page that threw as it was built, each a gap of its own. */
    this.pageErrors = [];
    /** The ids of the page's elements. */
    this.ids = new Set();
    this.harness = false;
    this.completed = new Promise((resolve) => (this.complete = resolve));
  }

  /** An error no script caught, told to the page as a browser tells it. */
  uncaught(error) {
    const event = new Event('error', { cancelable: true });
    const message = describe(error);
    Object.assign(event, { message, filename: this.path, lineno: 0, colno: 0, error });
    globalThis.dispatchEvent(event);
    try {
      globalThis.onerror?.(message, this.path, 0, 0, error);
    } catch {
      // The handler's own error is not another to report.
    }
  }

  rejected(reason, promise) {
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.assign(event, { reason, promise });
    globalThis.dispatchEvent(event);
  }

  /**
   * Run a script as a page's: what it declares at its top level is the global object's. By an
   * indirect `eval`, which leaves those deletable, but for a script that is strict throughout:
   * `eval` keeps what such a script declares to itself, so it is run as a script of the realm,
   * and what it declares is emptied after the file and not deleted.
   */
  evaluate({ code, strict }, name) {
    try {
      if (strict) runInThisContext(code, { filename: `wpt:///${name}` });
      else (0, eval)(`${code}\n//# sourceURL=wpt:///${name}`);
    } catch (error) {
      this.uncaught(error);
    }
  }

  /** The harness has just been read: say how it is to run, and hear what it reports. */
  hook() {
    this.harness = true;
    const subtest = (test) => ({
      name: String(test.name),
      status: TEST_STATUS[test.status] ?? String(test.status),
      message: short(test.message),
      stack: short(test.stack),
    });
    globalThis.setup({ output: false, explicit_timeout: true });
    globalThis.add_result_callback((test) => this.finished.push(subtest(test)));
    globalThis.add_completion_callback((tests, status) =>
      this.complete({
        status: FILE_STATUS[status.status] ?? String(status.status),
        message: short(status.message),
        subtests: tests.map(subtest),
      }),
    );
  }

  script({ src, code }) {
    if (code !== undefined) return this.evaluate(hoist(code), this.path);
    const path = resolveScript(src, this.path);
    if (path === undefined || isReport(path)) return;
    this.evaluate(scriptAt(path), path);
    if (path === HARNESS) this.hook();
  }

  page(source) {
    this.ids = buildPage(
      source,
      globalThis.document,
      (script) => this.script(script),
      (error, token) => {
        const what = token.open ? `<${token.open}>` : Object.keys(token)[0];
        this.pageErrors.push(`${what}: ${describe(error)}`);
      },
    );
  }

  /** A `.any.js` or `.window.js` test, in the page the test server would wrap it in. */
  scriptTest(source) {
    const meta = metaOf(source);
    globalThis.GLOBAL = {
      isWindow: () => true,
      isWorker: () => false,
      isShadowRealm: () => false,
    };
    if (meta.title) globalThis.META_TITLE = meta.title;
    this.script({ src: `/${HARNESS}` });
    for (const src of meta.script) this.script({ src });
    this.evaluate(hoist(source), this.path);
  }

  loaded() {
    globalThis.document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
    const event = new Event('load');
    globalThis.dispatchEvent(event);
    for (const handler of [globalThis.onload, this.bodyHandler()]) {
      try {
        handler?.(event);
      } catch (error) {
        this.uncaught(error);
      }
    }
  }

  /** `<body onload="...">`, which a page starts its tests from. */
  bodyHandler() {
    let written;
    try {
      written = globalThis.document.body.getAttribute('onload');
    } catch {
      return undefined;
    }
    return written ? () => this.evaluate({ code: written }, this.path) : undefined;
  }

  /** What the harness reported, or what it had when it was out of time. */
  async outcome(source) {
    const long = /name\s*=\s*["']?timeout["']?\s+content\s*=\s*["']?long|META:\s*timeout=long/;
    const limit = long.test(source) ? this.limit * 3 : this.limit;
    let outcome = await Promise.race([this.completed, delay(limit)]);
    if (outcome) return outcome;
    try {
      globalThis.timeout?.();
    } catch {
      // The harness could not be told: what finished is reported below.
    }
    outcome = await Promise.race([this.completed, delay(50)]);
    if (outcome) return outcome;
    const message = this.harness ? 'the harness did not complete' : 'the harness was not loaded';
    return { status: this.harness ? 'TIMEOUT' : 'ERROR', message, subtests: this.finished };
  }

  async run() {
    const source = readFileSync(join(CHECKOUT, this.path), 'utf8');
    if (this.path.endsWith('.js')) this.scriptTest(source);
    else this.page(source);
    // A browser's page has its `load` once the frames in it have had theirs.
    // Only then: a page with none has it at once, as it did, which an observer's timing reads.
    if (framesLoading?.()) await Promise.race([framesLoaded(), delay(this.limit)]);
    this.loaded();
    const outcome = await this.outcome(source);
    return { ...outcome, pageErrors: this.pageErrors, namedAccess: this.namedAccess(outcome) };
  }

  /**
   * The ids of the page that a failure says are not defined: a browser has each element with an
   * id as a property of `window`, and a test reads one by its bare name.
   */
  namedAccess(outcome) {
    const said = [outcome.message, ...outcome.subtests.map((test) => test.message)].join('\n');
    return [...this.ids].filter((id) => said.includes(`${id} is not defined`));
  }
}

/** The file being run, which an error with no one to catch it is this file's. */
let current;
process.on('uncaughtException', (error) => current?.uncaught(error));
process.on('unhandledRejection', (reason, promise) => current?.rejected(reason, promise));

function emptyPage() {
  try {
    const { body, head } = globalThis.document;
    for (const holder of [body, head]) {
      for (const child of [...holder.childNodes]) holder.removeChild(child);
    }
  } catch {
    // A page a test broke is gone with its app, below.
  }
}

async function runFile(path, limit) {
  const file = new FileRun(path, limit);
  const unshim = shimWindow();
  const untrack = trackTimers();
  let before;
  let prototypes;
  const started = performance.now();
  try {
    // The window a test is written for: WPT's runners open one 800 by 600, at the address its
    // server gives the file, which a relative URL in it resolves against.
    const providers = [
      // The emulated frame document, which a test reads as one of the same origin.
      provideWebCompat({ url: ORIGIN, loadFrame, frames: 'emulated' }),
      ...(StillLocation
        ? [
            {
              provide: PlatformLocation,
              useValue: Object.assign(new StillLocation(), { pathname: `/${path}` }),
            },
          ]
        : []),
    ];
    const { fabric } = await render(Page, { providers, conditions: WINDOW });
    // Laid out by Yoga as a device lays it out, so a box read back is where native would put it.
    layOutFabric(fabric, { screen: WINDOW, measure: true, scrolls: true });
    before = snapshot();
    prototypes = snapshotPrototypes();
    current = file;
    return { ...(await file.run()), ms: Math.round(performance.now() - started) };
  } catch (error) {
    const crash = { status: 'CRASH', message: short(describe(error)), subtests: file.finished };
    return {
      ...crash,
      pageErrors: file.pageErrors,
      namedAccess: file.namedAccess(crash),
      ms: Math.round(performance.now() - started),
    };
  } finally {
    current = undefined;
    emptyPage();
    if (before) restore(before);
    if (prototypes) restorePrototypes(prototypes);
    // After the global object is put back: the snapshot was taken with the timers tracked, and
    // would put the tracking back where this has just taken it away.
    untrack();
    try {
      await cleanup();
    } catch {
      // An app a test broke: the next file has a new one, and the process is not kept long.
    }
    unshim();
  }
}

function quiet() {
  if (process.env.WPT_VERBOSE) return;
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'])
    console[method] = () => {};
}

process.once('message', async ({ files, timeout }) => {
  quiet();
  for (const path of files) {
    process.send({ type: 'start', path });
    const result = await runFile(path, timeout);
    process.send({ type: 'result', path, result });
  }
  process.send({ type: 'done' }, () => process.exit(0));
});
