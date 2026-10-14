/**
 * Named imports from an `@ng-icons` set, replaced with the SVG strings they name.
 *
 * A set is one module holding every icon it has - `@ng-icons/lucide` is 872 KB of 1,991 strings -
 * and Metro keeps a module whole, so importing three icons shipped them all: about a quarter of a
 * release bundle. Reading the three strings out of the set at build time means the set's module
 * is never in the graph at all, in development or release.
 *
 * Only a plain named import is rewritten, and only when every name is in the set. Anything else -
 * a namespace import, a type import, a name the set does not have - is left for the ordinary
 * import to handle, so its error is the real one. The replacement takes as many lines as the
 * import did, wrapped over several or not, so every line after it keeps its number and the source
 * map stays right.
 *
 * ponytail: an import is found with a regex too, and one after an odd number of backticks is taken
 * to be text inside a template literal, a code sample an app shows, and left as it is. A backtick
 * on its own in a comment above an import leaves that import to the bundler, whole set and all.
 *
 * ponytail: a set is parsed with a regex over its published `fesm2022` file, which is one
 * `const name = \`<svg ...>\`;` per icon; a set published in another shape is left alone.
 */
const { readdirSync, readFileSync, statSync } = require('node:fs');
const path = require('node:path');

const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*['"](@ng-icons\/(?!core\b)[^'"]+)['"];?[ \t]*$/gm;
const CONST = /^const (\w+) = (`[^`]*`|\w+);$/gm;
const EXPORT = /^export \{([^}]*)\};?$/m;

/** @type {Map<string, { mtime: number, icons: Map<string, string> }>} */
const sets = new Map();

/**
 * The string `name` holds, following an alias - `const lucideXSquare = lucideSquareX;` - to the
 * icon it names.
 *
 * @param {Map<string, string>} values
 * @param {string} name
 */
function literalOf(values, name) {
  let value = values.get(name);
  for (let hops = 0; value && !value.startsWith('`') && hops < 8; hops++) value = values.get(value);
  return value?.startsWith('`') ? value : undefined;
}

/** Every exported icon of the set at `file`, as its source literal. */
function iconsIn(file) {
  const mtime = statSync(file).mtimeMs;
  const cached = sets.get(file);
  if (cached?.mtime === mtime) return cached.icons;

  const source = readFileSync(file, 'utf8');
  const values = new Map();
  for (const [, name, value] of source.matchAll(CONST)) values.set(name, value);
  const icons = new Map();
  for (const entry of (EXPORT.exec(source)?.[1] ?? '').split(',')) {
    const [local, exported = local] = entry.trim().split(/\s+as\s+/);
    const value = local && literalOf(values, local);
    if (value) icons.set(exported, value);
  }
  sets.set(file, { mtime, icons });
  return icons;
}

/**
 * @param {string} src
 * @param {string} filename
 */
function inlineIcons(src, filename) {
  if (!src.includes('@ng-icons/')) return src;
  return src.replace(IMPORT, (statement, list, specifier, at) => {
    if (/^\s*type\b/.test(list)) return statement;
    if ((src.slice(0, at).match(/(?<!\\)`/g) ?? []).length % 2) return statement;
    let file;
    try {
      file = require.resolve(specifier, { paths: [path.dirname(filename)] });
    } catch {
      return statement;
    }
    const icons = iconsIn(file);
    const bindings = [];
    for (const part of list.split(',')) {
      const entry = part.trim();
      if (!entry) continue;
      const [imported, local = imported] = entry.split(/\s+as\s+/);
      const value = icons.get(imported);
      if (!value) return statement;
      bindings.push(`${local} = ${value}`);
    }
    if (!bindings.length) return statement;
    const replacement = `const ${bindings.join(', ')};`;
    return replacement + '\n'.repeat(Math.max(0, lines(statement) - lines(replacement)));
  });
}

/** How many line breaks a piece of source holds. */
const lines = (text) => text.split('\n').length - 1;

/** The names in `dir`, or none where it does not exist. */
function namesIn(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Every icon set installed for the app, with its version, for the transform cache key.
 *
 * A set is read while the app's own file is transformed, so it is an input of that file's
 * transform that Metro knows nothing about. Upgraded with an icon redrawn, every file importing it
 * kept the old SVG in a release build, and in a dev server after a restart, until a `--clear`. In
 * the key, installing, upgrading or removing a set starts the cache afresh.
 *
 * Up the app's own `node_modules` folders, as `babelPluginVersions` in `config.cjs` looks, and
 * through pnpm's store there, which holds one folder per set and version whichever workspace
 * package depends on it.
 */
function iconSetVersions(projectRoot) {
  const found = new Set();
  for (let dir = path.resolve(projectRoot ?? process.cwd()); ; dir = path.dirname(dir)) {
    const scope = path.join(dir, 'node_modules', '@ng-icons');
    for (const name of namesIn(scope)) {
      if (name === 'core') continue;
      try {
        const manifest = path.join(scope, name, 'package.json');
        found.add(`@ng-icons/${name}@${JSON.parse(readFileSync(manifest, 'utf8')).version}`);
      } catch {
        // Not a package: nothing a set could be read from.
      }
    }
    for (const name of namesIn(path.join(dir, 'node_modules', '.pnpm'))) {
      if (name.startsWith('@ng-icons+') && !name.startsWith('@ng-icons+core@')) found.add(name);
    }
    if (path.dirname(dir) === dir) break;
  }
  return found.size ? `ng-icons-${[...found].sort().join(',')}` : undefined;
}

module.exports = { inlineIcons, iconSetVersions };
