/**
 * The migrations as `nx migrate` and `ng update` call them.
 *
 * Each tool loads a migration from its package's `migrations.json` as `./migrations/run.cjs#name`,
 * and `@ng-native/nx` and `@ng-native/schematics` make that file one line: `forNx()` or
 * `forAngular()`. Neither imports Nx or the Angular devkit here; each only wraps the `Tree` the
 * tool passes in as a host.
 */
const { migrations } = require('./migrations.cjs');

/** @param {import('@nx/devkit').Tree} tree @returns {import('./host.cjs').Host} */
function nxHost(tree) {
  return {
    read: (path) => (tree.isFile(path) ? tree.read(path, 'utf-8') : null),
    write: (path, text) => tree.write(path, text),
    list(dir) {
      const files = [];
      const dirs = [];
      for (const name of tree.children(dir)) {
        (tree.isFile(dir ? `${dir}/${name}` : name) ? files : dirs).push(name);
      }
      return { files, dirs };
    },
  };
}

/** @param {import('@angular-devkit/schematics').Tree} tree @returns {import('./host.cjs').Host} */
function angularHost(tree) {
  return {
    read: (path) => (tree.exists(path) ? tree.readText(path) : null),
    write: (path, text) =>
      tree.exists(path) ? tree.overwrite(path, text) : tree.create(path, text),
    list(dir) {
      const entry = tree.getDir(`/${dir}`);
      return { files: entry.subfiles.map(String), dirs: entry.subdirs.map(String) };
    },
  };
}

/**
 * Each migration as the function `nx migrate` calls with its `Tree`. What it answers is printed as
 * the next steps.
 */
function forNx() {
  return Object.fromEntries(
    migrations.map(({ name, run }) => [name, async (tree) => run(nxHost(tree))]),
  );
}

/**
 * Each migration as the factory `ng update` calls, whose rule logs what is left to do as a
 * warning, which `ng update` prints.
 */
function forAngular() {
  return Object.fromEntries(
    migrations.map(({ name, run }) => [
      name,
      () => (tree, context) => {
        for (const note of run(angularHost(tree))) context.logger.warn(note);
      },
    ]),
  );
}

module.exports = { forNx, forAngular };
