/**
 * Which files of the checkout are tests this runner can run, and for each that is not, why.
 *
 * Nothing is dropped without a reason: every file under a suite is run, skipped with a reason
 * that is counted in the summary, or is a support file, which is counted too.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { CHECKOUT } from './pin.mjs';
import { hasModuleScript, scriptSources } from './page.mjs';

/** Directories that hold what tests load, not tests. */
const SUPPORT_DIRECTORY = /(^|\/)(resources|support|tools|reference|references)\//;
const PAGE = /\.(html|htm)$/;
const SCRIPT_TEST = /\.(any|window)\.js$/;
const XML = /\.(xhtml|xht|xml|svg)$/;

/** Every file under a directory of the checkout, as paths from the checkout's root, sorted. */
export function filesUnder(directory) {
  const found = [];
  const walk = (at) => {
    for (const entry of readdirSync(join(CHECKOUT, at), { withFileTypes: true })) {
      const path = posix.join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  walk(directory);
  return found.sort();
}

/** Where a script a test names is in the checkout: from the root, or beside the test. */
export function resolveScript(src, from) {
  const path = src.replace(/[?#].*$/, '');
  if (/^[a-z]+:/i.test(path)) return undefined;
  return path.startsWith('/') ? path.slice(1) : posix.join(dirname(from), path);
}

/**
 * Where a path from the root of the checkout is on disk, where that is inside the checkout: a
 * `..` a test wrote, or one an encoded slash hid from a URL, does not reach what is beside it.
 */
export function inCheckout(path) {
  const file = resolve(CHECKOUT, path);
  return file.startsWith(resolve(CHECKOUT) + sep) ? file : undefined;
}

/** The harness's own report, which the runner stands in for. */
export const isReport = (path) => path === 'resources/testharnessreport.js';

/** What a test's name alone says it cannot be run for, if anything. */
function byName(path) {
  if (/\.sub\./.test(path)) return 'needs a server (.sub.)';
  if (/\.(https|h2|www)\./.test(path)) return 'needs a server (.https.)';
  if (/-manual\./.test(path) || /(^|\/)manual\//.test(path)) return 'manual test';
  if (/-crash\./.test(path) || /(^|\/)crashtests\//.test(path)) return 'crashtest (no assertions)';
  if (/\.worker\.js$/.test(path)) return 'worker only';
  if (XML.test(path)) return 'XML document (the runner reads HTML only)';
  return undefined;
}

/** What the scripts a test loads say it cannot be run for, if anything. */
function byScripts(sources, path) {
  for (const src of sources) {
    const script = resolveScript(src, path);
    if (script === undefined) return 'loads a script from another origin';
    if (/testdriver/.test(script)) return 'needs testdriver (input automation)';
    if (/\.sub\.|\?pipe=/.test(src)) return 'needs a server (.sub. script)';
    if (isReport(script)) continue;
    const file = inCheckout(script);
    if (!file) return 'loads a script outside the checkout';
    // A directory is not a script either: reading one as a script throws.
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
      return 'loads a script the checkout does not have';
    }
  }
  return undefined;
}

function pageSkip(path, source) {
  if (/<link[^>]+rel\s*=\s*["']?(mis)?match\b/i.test(source)) return 'reftest';
  const sources = scriptSources(source);
  const harness = sources.some((src) => resolveScript(src, path) === 'resources/testharness.js');
  if (!harness) return 'no testharness (a reference, visual or print page)';
  const loads = byScripts(sources, path);
  if (loads) return loads;
  return hasModuleScript(source)
    ? 'module script (the runner runs classic scripts only)'
    : undefined;
}

/** The `// META:` lines at the head of a script test, by key. */
export function metaOf(source) {
  const meta = { script: [], global: undefined, timeout: undefined, title: undefined };
  for (const line of source.split('\n')) {
    const found = /^\/\/\s*META:\s*(\w+)=(.*)$/.exec(line.trim());
    if (found) {
      if (found[1] === 'script') meta.script.push(found[2].trim());
      else meta[found[1]] = found[2].trim();
    } else if (line.trim() !== '' && !line.startsWith('//')) break;
  }
  return meta;
}

function scriptSkip(path, source) {
  const meta = metaOf(source);
  const globals = meta.global?.split(',').map((each) => each.trim());
  const windowed = !globals || globals.some((each) => each === 'window' || each === '!default');
  if (path.endsWith('.any.js') && !windowed) return 'worker only';
  return byScripts(meta.script, path);
}

/**
 * What to do with one file: `{ kind: 'run' }`, `{ kind: 'skip', reason }`, or
 * `{ kind: 'support' }` for a file that is no test.
 */
export function classify(path) {
  const page = PAGE.test(path);
  const testLike = page || SCRIPT_TEST.test(path) || XML.test(path) || /\.worker\.js$/.test(path);
  if (!testLike || SUPPORT_DIRECTORY.test(path)) return { kind: 'support' };
  if (/-(not)?ref(-\d+)?\.[a-z]+$/.test(path)) return { kind: 'support' };
  const named = byName(path);
  if (named) return { kind: 'skip', reason: named };
  const source = readFileSync(join(CHECKOUT, path), 'utf8');
  const reason = page ? pageSkip(path, source) : scriptSkip(path, source);
  return reason ? { kind: 'skip', reason } : { kind: 'run' };
}

/** The suite a file is counted under: the longest of the suites it is in. */
export function suiteOf(path, suites) {
  return suites
    .filter((suite) => path === suite || path.startsWith(`${suite}/`))
    .sort((a, b) => b.length - a.length)[0];
}
