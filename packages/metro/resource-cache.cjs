/**
 * A component's cached transform, served only while its external templates and stylesheets are as
 * they were when it was made.
 *
 * Metro keys a cached transform on the file's own content, and a component's template and sheet
 * are compiled into its own module. So a template or stylesheet edited on its own left the
 * component's key where it was, and a release build from a warm cache shipped what the component
 * looked like the last time its own file changed: two `npx expo export` runs, the same bundle, and
 * only `--clear` showed the edit. A dev server is not caught out, because the resource's own module
 * carries the edit there (see `resourceBlock`), but a release build empties that module.
 *
 * The transform worker writes down each resource a transform read and a hash of its text, and the
 * cache stores Metro is given read that back: a transform whose resources have changed, or gone,
 * is a miss, so Metro transforms the file again and writes the new one over it under the same key.
 * The cache is the only thing Metro asks before it reuses a transform, so it is the only place the
 * check can go. Expo does the same for a stylesheet Tailwind reads the whole project for, with a
 * `skipCache` its own stores look at; this keeps the cache, and works with any store.
 *
 * A running dev server asks no cache: it keeps each module it transformed in its graph, and
 * transforms one again only when that file changes. So a dev server holds the same list on each
 * module of its graph, and transforms again a module whose resources have changed, or gone,
 * before it answers a bundle request or sends a hot update: see `rereadingResources`.
 */
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { takeResourcesRead } = require('./angular-transform.cjs');

/**
 * Where a transform result keeps its resources, `{ file, sha1 }` each, the file from the project:
 * on the data of its first output, which is what a dev server's graph keeps of a module.
 */
const RESOURCES = 'angularNativeResources';

const sha1Of = (file) => createHash('sha1').update(readFileSync(file)).digest('hex');

/** The resources a transform result, or a module of a dev server's graph, was made from. */
const resourcesOf = (value) => value?.output?.[0]?.data?.[RESOURCES] ?? [];

/**
 * The result, with the resources the transform of `filename` read written onto it. Named from the
 * project root, as Metro names `filename`, so a cache moved with the project still holds.
 */
function withResources(result, projectRoot, filename, alsoRead = []) {
  const resources = [...takeResourcesRead(filename), ...alsoRead].map((absolute) => ({
    file: path.relative(projectRoot, absolute),
    sha1: sha1Of(absolute),
  }));
  const [first, ...rest] = result?.output ?? [];
  if (!resources.length || !first) return result;
  return {
    ...result,
    output: [{ ...first, data: { ...first.data, [RESOURCES]: resources } }, ...rest],
  };
}

/** Whether every resource a cached result was made from still has the text it had. */
function resourcesCurrent(value, projectRoot) {
  for (const { file, sha1 } of resourcesOf(value)) {
    try {
      if (sha1Of(path.resolve(projectRoot, file)) !== sha1) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Each store, answering a miss for a transform whose resources have changed. The store is called
 * rather than extended: Expo's keeps its directory in a private field, which only the store itself
 * can read.
 */
function checkingResources(stores, projectRoot) {
  if (!Array.isArray(stores)) return stores;
  return stores.map((store) =>
    store[RESOURCES]
      ? store
      : {
          [RESOURCES]: true,
          name: store.name ?? store.constructor?.name,
          async get(key) {
            const value = await store.get(key);
            return value != null && !resourcesCurrent(value, projectRoot) ? null : value;
          },
          set: (key, value) => store.set(key, value),
          clear: () => store.clear?.(),
        },
  );
}

/** The Metro servers already told that a resource edit reaches the app through its own module alone. */
const WARNED = new WeakSet();

const SINGLE_MODULE_ADVICE =
  "So an edit to only a component's templateUrl or styleUrl reaches a running app through that file's own module alone. Save the component, or restart Metro, if the edit does not show.";

const SINGLE_MODULE = `[angular-native] This Metro cannot transform a component again when its resources change. ${SINGLE_MODULE_ADVICE}`;

/**
 * The delta bundler and bundler a Metro dev server rereads resources through, or null where it
 * has not both, said once for that server.
 */
function hooksOf(server) {
  const incremental = server?.getBundler?.();
  const deltaBundler = incremental?.getDeltaBundler?.();
  const bundler = incremental?.getBundler?.();
  if (
    typeof deltaBundler?.getDelta === 'function' &&
    typeof bundler?.transformFile === 'function'
  ) {
    return { deltaBundler, bundler };
  }
  if (incremental) warnOnce(server);
  return null;
}

/** Says once for a Metro server that a resource edit reaches the app through its own module. */
function warnOnce(server) {
  if (WARNED.has(server)) return;
  WARNED.add(server);
  console.warn(SINGLE_MODULE);
}

/**
 * A dev server that transforms again each module of a graph whose resources have changed, or gone,
 * whenever it works out what changed in that graph: for a bundle request, a reload's or a
 * relaunch's, and for a hot update.
 *
 * Metro hears of the edit to a template, but transforms again only the template's own module, and
 * a component compiled with the template kept the old one until its own file changed. A touch that
 * keeps the file's text is not a change to Metro either. So two things are added to the server:
 *
 * - The modules made from a changed resource are added to the files the graph's calculator holds
 *   as changed, as Expo adds the modules an environment variable it read has changed under, and
 *   Metro transforms them as if they had been saved. The cache stores above find them stale too.
 * - Each transform's key names the resources it was made from. Metro keeps the module it has when
 *   a new transform comes back under the same key, which one of an unchanged file always did, so
 *   the component compiled again was dropped for the one it replaced. Expo varies the key the same
 *   way for what its transforms read from the environment.
 *
 * Metro has no public way in, so this reads the calculator of each graph and the files it holds as
 * changed, which Metro has kept under these names for years and Expo reads as well. A Metro
 * without them is left as it is, said once: an edit to only a template then reaches a running app
 * through the template's own module alone.
 */
function rereadingResources(server, projectRoot) {
  const hooks = hooksOf(server);
  if (!hooks) return;
  const { deltaBundler, bundler } = hooks;
  if (deltaBundler[RESOURCES]) return;
  deltaBundler[RESOURCES] = true;

  const transformFile = bundler.transformFile;
  bundler.transformFile = async function (...args) {
    const result = await transformFile.apply(this, args);
    const resources = resourcesOf(result);
    if (!resources.length || result.unstable_transformResultKey == null) return result;
    const read = resources.map(({ file, sha1 }) => `${file}:${sha1}`).join('\0');
    return {
      ...result,
      unstable_transformResultKey: `${result.unstable_transformResultKey}+${createHash('sha1').update(read).digest('hex')}`,
    };
  };

  const getDelta = deltaBundler.getDelta;
  let warned = false;
  deltaBundler.getDelta = function (graph, options) {
    const changed = this._deltaCalculators?.get?.(graph)?._modifiedFiles;
    if (changed instanceof Set) {
      for (const [file, module] of graph?.dependencies ?? []) {
        if (!resourcesCurrent(module, projectRoot)) changed.add(file);
      }
    } else if (!warned) {
      warned = true;
      console.warn(
        `[angular-native] This Metro does not say which files changed in a way that can be added to. ${SINGLE_MODULE_ADVICE}`,
      );
    }
    return getDelta.call(this, graph, options);
  };
}

module.exports = { withResources, checkingResources, rereadingResources };
