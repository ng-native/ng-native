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
const { typescript } = require('@ng-native/migrate/move-imports.cjs');
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
 * The object `mount` is given in main.ts: what `mountOptions = () => ({ ... })` returns, or the
 * object a `mount(...)` call is passed inline, as an older app does. Found by TypeScript's parser,
 * so a comment, string or regular expression in it reads as what it is.
 */
function mountOptionsObject(ts, file) {
  let found = null;
  const visit = (node) => {
    found = returnedByMountOptions(ts, node) ?? passedToMount(ts, node);
    if (!found) found = ts.forEachChild(node, visit) ?? null;
    return found;
  };
  return visit(file);
}

/** The object `const mountOptions = () => ({ ... })` returns, when `node` declares it. */
function returnedByMountOptions(ts, node) {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return null;
  if (node.name.text !== 'mountOptions' || !node.initializer) return null;
  if (!ts.isArrowFunction(node.initializer)) return null;
  let body = node.initializer.body;
  while (ts.isParenthesizedExpression(body)) body = body.expression;
  return ts.isObjectLiteralExpression(body) ? body : null;
}

/** The options object a `mount(...)` call is passed inline, when `node` is one. */
function passedToMount(ts, node) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return null;
  const options = node.expression.text === 'mount' ? node.arguments[3] : undefined;
  return options && ts.isObjectLiteralExpression(options) ? options : null;
}

/** Where to add `provideNativeScript()` to `options`, and what: null for a file to edit by hand. */
function providerEdit(ts, file, options) {
  const named = options.properties.filter(
    (property) =>
      property.name && ts.isIdentifier(property.name) && property.name.text === 'providers',
  );
  const own = named.at(-1);
  if (own) {
    // A list to add to; anything else (a variable, a spread) is the app's to change.
    const list = ts.isPropertyAssignment(own) ? own.initializer : null;
    return list && ts.isArrayLiteralExpression(list)
      ? { at: list.getStart(file) + 1, text: `${PROVIDER}, ` }
      : null;
  }
  // First, straight after the brace: before any comment that heads the first property.
  const first = options.properties[0];
  if (!first) return null;
  const start = first.getStart(file);
  const indent = /[ \t]*$/.exec(file.text.slice(file.text.lastIndexOf('\n', start) + 1, start))[0];
  return { at: options.getStart(file) + 1, text: `\n${indent}providers: [${PROVIDER}],` };
}

const IMPORTED =
  /\bimport\s*\{[^}]*\bprovideNativeScript\b[^}]*\}\s*from\s*['"]@ng-native\/nativescript['"]/;

function addProvider(tree, root) {
  const file = joinPathFragments(root, 'src/main.ts');
  const main = tree.read(file, 'utf-8');
  if (main === null) return byHand(file, 'it does not exist.');
  if (main.includes(PROVIDER)) return;
  const imports = [...main.matchAll(/^import .+;$/gm)];
  let edit = null;
  try {
    const ts = typescript();
    const source = ts.createSourceFile(file, main, ts.ScriptTarget.Latest, true);
    const options = mountOptionsObject(ts, source);
    edit = options && providerEdit(ts, source, options);
  } catch {
    // No TypeScript with a JavaScript API (TypeScript 7): the same as a file it cannot follow.
  }
  if (!imports.length || !edit) {
    return byHand(
      file,
      `import { provideNativeScript } from '@ng-native/nativescript' and add ${PROVIDER} to the ` +
        'providers mount is given.',
    );
  }
  const updated = main.slice(0, edit.at) + edit.text + main.slice(edit.at);
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
