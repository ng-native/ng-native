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
 */
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { takeResourcesRead } = require('./angular-transform.cjs');

/** Where a transform result keeps its resources, `{ file, sha1 }` each, the file from the project. */
const RESOURCES = 'angularNativeResources';

const sha1Of = (file) => createHash('sha1').update(readFileSync(file)).digest('hex');

/**
 * The result, with the resources the transform of `filename` read written onto it. Named from the
 * project root, as Metro names `filename`, so a cache moved with the project still holds.
 */
function withResources(result, projectRoot, filename, alsoRead = []) {
  const resources = [...takeResourcesRead(filename), ...alsoRead].map((absolute) => ({
    file: path.relative(projectRoot, absolute),
    sha1: sha1Of(absolute),
  }));
  return resources.length ? { ...result, [RESOURCES]: resources } : result;
}

/** Whether every resource a cached result was made from still has the text it had. */
function resourcesCurrent(value, projectRoot) {
  for (const { file, sha1 } of value?.[RESOURCES] ?? []) {
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

module.exports = { withResources, checkingResources };
