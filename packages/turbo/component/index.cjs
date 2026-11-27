/**
 * `turbo gen ng-native-component`: a component for an Angular Native app or library of this
 * workspace.
 *
 * It writes what `@ng-native/nx` and `@ng-native/schematics` write: a component built from `<view>`
 * and `<text>`, with an inline template, and a `.test.ts` beside it that renders it on the fake
 * Fabric. It goes under `src/app` in an app and `src/lib` in a library, in a folder of its own
 * unless flat. In a library, `src/index.ts` exports it, since the library is used through its
 * index.
 */
const path = require('node:path').posix;
const { componentSource, testSource } = require('./sources.cjs');
const { workspacePackages, isNativeApp, isNativeLibrary } = require('../workspace.cjs');

/** @typedef {ReturnType<typeof import('../files.cjs').workspaceFiles>} Files */

/** The names the component's source imports, which its own class would shadow. */
const IMPORTED = ['Component', 'Text', 'View'];

/**
 * The file name, kebab-case, and the class name a name such as `profileCard` or `Profile card`
 * gives.
 *
 * @param {string} name
 */
function names(name) {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (!words.length || !/^[a-z]/.test(words[0])) {
    throw new Error(`${JSON.stringify(name)} cannot name a component: start it with a letter.`);
  }
  const className = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('');
  if (IMPORTED.includes(className)) {
    throw new Error(
      `${JSON.stringify(name)} cannot name a component: its class, ${className}, is a name the ` +
        'component imports. Give it another, such as profile-card.',
    );
  }
  return { fileName: words.join('-'), className };
}

/**
 * The prefix of a library's selectors: its package's scope, `acme` for `@acme/ui`, as Angular
 * prefixes a library's own. An app's components take none, as the template's root does not.
 *
 * @param {string | undefined} packageName
 */
function selectorPrefix(packageName) {
  const prefix = packageName?.match(/^@([^/]+)\//)?.[1]?.toLowerCase();
  return prefix && /^[a-z][a-z0-9-]*$/.test(prefix) ? prefix : undefined;
}

/**
 * The component `file` in `folder`, and its test unless `skipTests`. The library generator writes
 * its first component with this too.
 *
 * @param {Files} files
 * @param {string} folder
 * @param {string} file the file name, kebab-case, without `.ts`
 * @param {string | undefined} prefix the selector prefix
 * @param {boolean} [skipTests]
 */
function writeComponent(files, folder, file, prefix, skipTests = false) {
  const { className } = names(file);
  const selector = prefix ? `${prefix}-${file}` : file;
  const label = `${file} works`;
  files.write(`${folder}/${file}.ts`, componentSource(className, selector, label));
  if (!skipTests) files.write(`${folder}/${file}.test.ts`, testSource(className, file, label));
  return className;
}

/**
 * The Angular Native apps and libraries a component can go in, by package name.
 *
 * @param {Files} files
 */
function componentTargets(files) {
  return workspacePackages(files).filter(
    (pkg) => pkg.manifest.name && (isNativeApp(files, pkg) || isNativeLibrary(files, pkg)),
  );
}

/**
 * The app or library `name` names, by package name or directory.
 *
 * @param {Files} files
 * @param {string} name
 */
function findTarget(files, name) {
  const targets = componentTargets(files);
  const target = targets.find((pkg) => pkg.manifest.name === name || pkg.dir === name);
  if (target) return target;
  const known = targets.map((pkg) => pkg.manifest.name).join(', ') || 'none';
  throw new Error(
    `The workspace has no Angular Native app or library called "${name}". ` +
      `Those it has: ${known}.`,
  );
}

/**
 * Exports the component from the library's `src/index.ts`, when it has one.
 *
 * @param {Files} files
 * @param {string} root the library's directory
 * @param {string} file the component's file, without `.ts`
 * @param {string} className
 * @returns {string | undefined} the index, when the component was exported from it
 */
function exportFromIndex(files, root, file, className) {
  const index = `${root}/src/index.ts`;
  if (!files.exists(index)) return undefined;
  const from = `./${path.relative(`${root}/src`, file)}.ts`;
  const source = files.read(index) ?? '';
  if (new RegExp(`\\bexport\\b[^;]*\\b${className}\\b`).test(source)) {
    throw new Error(
      `${index} already exports ${className}. Give the component another name, or export it by hand.`,
    );
  }
  const before = source.trim() ? source.replace(/\n*$/, '\n') : '';
  files.write(index, `${before}export { ${className} } from '${from}';\n`);
  return index;
}

/**
 * @param {Files} files
 * @param {{ name: string, package: string, flat?: boolean, skipTests?: boolean }} options
 * @returns {Promise<string>}
 */
async function component(files, options) {
  const target = findTarget(files, options.package);
  const app = isNativeApp(files, target);
  const segments = options.name.replace(/\\/g, '/').split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(
      `${options.name} has to stay inside the package: give a name like cards/profile-card.`,
    );
  }
  const { fileName, className } = names(segments.at(-1) ?? '');
  const subfolder = segments.length > 1 ? `/${segments.slice(0, -1).join('/')}` : '';
  const base = `${target.dir}/src/${app ? 'app' : 'lib'}${subfolder}`;
  const folder = options.flat ? base : `${base}/${fileName}`;
  const file = `${folder}/${fileName}`;
  if (files.exists(`${file}.ts`)) throw new Error(`${file}.ts already exists.`);
  const prefix = app ? undefined : selectorPrefix(target.manifest.name);
  // The index first, so a name it already exports writes nothing.
  const index = app ? undefined : exportFromIndex(files, target.dir, file, className);
  writeComponent(files, folder, fileName, prefix, options.skipTests);
  return `Created ${file}.ts${index ? `, exported from ${index}` : ''}.`;
}

module.exports = { component, componentTargets, writeComponent, selectorPrefix, names };
