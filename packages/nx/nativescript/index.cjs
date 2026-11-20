/**
 * `nx g @ng-native/nx:nativescript mobile`: NativeScript's iOS and Android APIs in an Angular
 * Native app, through `@ng-native/nativescript`.
 *
 * An app needs the packages, `@ng-native/nativescript` among its config plugins (which links the
 * runtime and its metadata into the native build), the iOS and Android SDKs' types, and `provideNativeScript()`
 * among the providers `mount` is given. Metro supplies the Babel config: see `@ng-native/metro`'s
 * `nativescript-babel.cjs`.
 *
 * It only adds, so running it again changes nothing. A file it cannot follow is left alone, with a
 * warning saying what to add by hand.
 */
const {
  addDependenciesToPackageJson,
  formatFiles,
  getProjects,
  installPackagesTask,
  joinPathFragments,
  logger,
  readJson,
} = require('@nx/devkit');
const native = require('../native-app.cjs');
const { usesWorkspaces } = require('../application/workspaces.cjs');

// The iOS SDK's types ship with the runtime; Android's are a package of their own.
const TYPES =
  '/// <reference types="@nativescript/react-native/types/ios" />\n' +
  '/// <reference types="@nativescript/types-android" />\n';
const PROVIDER = 'provideNativeScript()';

/** The `react-native-worklets` each Expo SDK bundles, by its major; the template's SDK otherwise. */
const WORKLETS = { 57: '0.10.1', 58: '0.13.0' };
const worklets = (expo) => WORKLETS[/\d+/.exec(expo ?? '')?.[0]] ?? WORKLETS[58];

function byHand(file, what) {
  logger.warn(`Could not update ${file}: ${what}`);
}

function addPlugin(tree, root) {
  const file = joinPathFragments(root, 'app.json');
  const text = tree.read(file, 'utf-8');
  if (text === null) return byHand(file, 'it does not exist.');
  const config = JSON.parse(text);
  const expo = (config.expo ??= {});
  const plugins = (expo.plugins ??= []);
  const named = (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin);
  if (plugins.some((plugin) => named(plugin) === '@ng-native/nativescript')) return;
  plugins.push('@ng-native/nativescript');
  tree.write(file, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Where the bracket at `open` closes, counting brackets outside comments and strings, so a comment
 * such as `// 1) Convert native colours` does not end the scan; -1 if it never closes.
 */
function closing(source, open) {
  let depth = 0;
  for (let at = open; at < source.length; at++) {
    const past = skipped(source, at);
    if (past !== at) at = past;
    else if ('([{'.includes(source[at])) depth++;
    else if (')]}'.includes(source[at]) && --depth === 0) return at;
  }
  return -1;
}

/** Where a comment or string starting at `at` ends, or `at` itself where none starts there. */
function skipped(source, at) {
  const [char, next] = [source[at], source[at + 1]];
  if (char === '/' && next === '/') {
    const end = source.indexOf('\n', at);
    return end < 0 ? source.length : end;
  }
  if (char === '/' && next === '*') return source.indexOf('*/', at + 2) + 1 || source.length;
  if (char === "'" || char === '"' || char === '`') return stringEnd(source, at);
  return at;
}

/** Where the string starting at `open` ends, past its escapes. */
function stringEnd(source, open) {
  for (let at = open + 1; at < source.length; at++) {
    if (source[at] === '\\') at++;
    else if (source[at] === source[open]) return at;
  }
  return source.length;
}

const IMPORTED =
  /\bimport\s*\{[^}]*\bprovideNativeScript\b[^}]*\}\s*from\s*['"]@ng-native\/nativescript['"]/;

function addProvider(tree, root) {
  const file = joinPathFragments(root, 'src/main.ts');
  const main = tree.read(file, 'utf-8');
  if (main === null) return byHand(file, 'it does not exist.');
  if (main.includes(PROVIDER)) return;
  const imports = [...main.matchAll(/^import .+;$/gm)];
  const options = native.MOUNT_OPTIONS.exec(main);
  const open = options ? options.index + options[1].length - 2 : -1;
  const end = options ? closing(main, open) : -1;
  if (!imports.length || end < 0) {
    return byHand(
      file,
      `import { provideNativeScript } from '@ng-native/nativescript' and add ${PROVIDER} to the ` +
        'providers mount is given.',
    );
  }
  // Only a providers list inside the options: one elsewhere in the file is not the app's.
  const given = main.slice(open, end);
  const listed = /(\bproviders:\s*\[)/.exec(given);
  // A second providers key would replace the app's own, so one that is not a list is left alone.
  if (!listed && /\bproviders\s*[:,}]/.test(given)) {
    return byHand(file, `add ${PROVIDER} to the providers mount is given.`);
  }
  const indent = options[2];
  const edited = listed
    ? given.replace(listed[0], `${listed[1]}${PROVIDER}, `)
    : given.replace(`{\n${indent}`, `{\n${indent}providers: [${PROVIDER}],\n${indent}`);
  const updated = main.slice(0, open) + edited + main.slice(end);
  if (IMPORTED.test(updated)) return tree.write(file, updated);
  const last = imports.at(-1);
  const at = updated.indexOf(last[0]) + last[0].length;
  const imported = "\nimport { provideNativeScript } from '@ng-native/nativescript';";
  tree.write(file, updated.slice(0, at) + imported + updated.slice(at));
}

async function nativescript(tree, options) {
  const app = getProjects(tree).get(options.project);
  if (!app) throw new Error(`The workspace has no project called "${options.project}".`);
  addPlugin(tree, app.root);
  addProvider(tree, app.root);
  const types = joinPathFragments(app.root, 'src/nativescript.d.ts');
  if (!tree.exists(types)) tree.write(types, TYPES);

  const own = joinPathFragments(app.root, 'package.json');
  const manifest = usesWorkspaces(tree) && tree.exists(own) ? own : 'package.json';
  const install = addDependenciesToPackageJson(
    tree,
    {
      '@ng-native/nativescript': native.dependencies['@ng-native/components'],
      '@nativescript/react-native': '^9.1.2',
      'react-native-worklets': worklets(readJson(tree, manifest).dependencies?.expo),
    },
    { '@nativescript/types-android': '^9.1.1' },
    manifest,
  );
  if (!options.skipFormat) await formatFiles(tree);
  return options.skipInstall ? () => {} : () => (install(), installPackagesTask(tree));
}

module.exports = { nativescript, default: nativescript };
