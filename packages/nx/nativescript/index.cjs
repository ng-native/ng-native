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
} = require('@nx/devkit');
const native = require('../native-app.cjs');
const { usesWorkspaces } = require('../application/workspaces.cjs');

// The iOS SDK's types ship with the runtime; Android's are a package of their own.
const TYPES =
  '/// <reference types="@nativescript/react-native/types/ios" />\n' +
  '/// <reference types="@nativescript/types-android" />\n';
const PROVIDER = 'provideNativeScript()';

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

function addProvider(tree, root) {
  const file = joinPathFragments(root, 'src/main.ts');
  const main = tree.read(file, 'utf-8');
  if (main === null) return byHand(file, 'it does not exist.');
  if (main.includes(PROVIDER)) return;
  const imports = [...main.matchAll(/^import .+;$/gm)];
  const listed = /(\bproviders:\s*\[)/.exec(main);
  const options = /(\bmount\([^\n]*\{\n)([ \t]*)/.exec(main);
  if (!imports.length || (!listed && !options)) {
    return byHand(
      file,
      `import { provideNativeScript } from '@ng-native/nativescript' and add ${PROVIDER} to the ` +
        'providers mount is given.',
    );
  }
  const updated = listed
    ? main.replace(listed[0], `${listed[1]}${PROVIDER}, `)
    : main.replace(
        options[0],
        `${options[1]}${options[2]}providers: [${PROVIDER}],\n${options[2]}`,
      );
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
      '@nativescript/react-native': '^9.1.0',
      'react-native-worklets': '0.10.1',
    },
    { '@nativescript/types-android': '^9.1.1' },
    manifest,
  );
  if (!options.skipFormat) await formatFiles(tree);
  return options.skipInstall ? () => {} : () => (install(), installPackagesTask(tree));
}

module.exports = { nativescript, default: nativescript };
