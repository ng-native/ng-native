/**
 * Which Web Platform Tests are run against `@ng-native/web-compat`, and where they are kept.
 *
 * The tests are BSD-3-Clause and are not vendored: `fetch.mjs` checks them out at the commit
 * below into a cache that git ignores, and `run.mjs` refuses to run from a cache that is not
 * that commit, whole.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the tests are fetched from. `WPT_REPOSITORY` replaces it, for the fetch's own tests. */
export const REPOSITORY = process.env.WPT_REPOSITORY || 'https://github.com/web-platform-tests/wpt';

/**
 * The commit of `web-platform-tests/wpt` the expectations were recorded against. `WPT_COMMIT`
 * replaces it, for the runner's own tests.
 */
export const COMMIT = process.env.WPT_COMMIT || '6dcecaab61b33a51e04f49be43941461808193cc';

/** The directories whose tests are run. */
export const SUITES = [
  'dom/nodes',
  'dom/events',
  'dom/collections',
  'css/selectors',
  'html/canvas/element',
  'css/cssom',
  'uievents',
  'dom/traversal',
  'html/dom',
  'html/editing/the-hidden-attribute',
  'html/interaction/focus/sequential-focus-navigation-and-the-tabindex-attribute',
  'css/cssom-view',
  'resize-observer',
  'intersection-observer',
  'domparsing',
  'html/syntax/serializing-html-fragments',
  'html/syntax/parsing',
  'html/syntax/parsing-html-fragments',
];

/** What the tests load beside themselves: the harness, and helpers they name by an absolute path. */
export const SUPPORT = [
  'resources',
  'common',
  'css/support',
  'html/canvas/resources',
  'html/resources',
];

export const HERE = fileURLToPath(new URL('.', import.meta.url));
/** Where the checkout is kept. `WPT_CACHE` replaces it, for the runner's own tests. */
export const CACHE = process.env.WPT_CACHE || fileURLToPath(new URL('./.cache/', import.meta.url));
/** Written last by a fetch that finished: the commit and how many files it checked out. */
export const STAMP = join(CACHE, '.fetched.json');
export const CHECKOUT = join(CACHE, 'wpt/');

/**
 * What of the above the environment replaces, for the runner's own tests. Said by the fetch and
 * the run, so a variable left set in a shell is seen and not silently fetched and checked.
 */
export function replacedPin() {
  const names = ['WPT_COMMIT', 'WPT_REPOSITORY', 'WPT_CACHE'].filter((name) => process.env[name]);
  if (names.length) console.warn(`${names.join(', ')} replace the pin, from the environment`);
}
