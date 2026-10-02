/**
 * `ng generate @ng-native/schematics:application`: an Angular Native app inside an Angular CLI
 * workspace.
 *
 * The app is an Expo project in its own directory, beside whatever web app the workspace already
 * has, and Metro builds it rather than `@angular/build`. What makes it a project of this workspace
 * is its entry in `angular.json`: the builders there run Expo, so `ng serve native` starts Metro,
 * `ng build native` exports a bundle and `ng test native` runs its tests in Node.
 *
 * Its dependencies go in the root `package.json`, because an Angular CLI workspace has one. The
 * project's own `package.json` is for Expo, which reads `main` from it to find the entry file.
 */
const path = require('node:path').posix;
const { SchematicsException } = require('@angular-devkit/schematics');
const { NodePackageInstallTask } = require('@angular-devkit/schematics/tasks');
const native = require('../native-app.cjs');

function readJson(tree, file) {
  return JSON.parse(tree.readText(file));
}

function writeJson(tree, file, value) {
  tree.overwrite(file, JSON.stringify(value, null, 2) + '\n');
}

/**
 * The project's targets. Each is an Expo command run in the project's directory, which is where
 * Expo reads `app.json` and `metro.config.js` from.
 */
function targets(root, name) {
  const expo = (command, args) => ({
    builder: '@ng-native/schematics:expo',
    options: args ? { command, args } : { command },
  });
  // Beside the workspace's other build output, rather than in a `dist/` inside the project.
  const outputDir = path.relative(root, path.join('dist', name));
  return {
    serve: expo('start'),
    build: expo('export', ['--output-dir', outputDir]),
    'run-ios': expo('run:ios'),
    'run-android': expo('run:android'),
    test: { builder: '@ng-native/schematics:vitest', options: {} },
  };
}

/**
 * Angular's own schematics, which write a spec this project cannot run: each assumes Vitest's
 * globals and most assume `TestBed` on a DOM, and a test here renders onto the fake Fabric.
 */
const WEB_SPECS = [
  'class',
  'component',
  'directive',
  'guard',
  'interceptor',
  'pipe',
  'resolver',
  'service',
];

function project(root, name, prefix) {
  return {
    projectType: 'application',
    root,
    sourceRoot: root,
    prefix,
    // `ng generate component` run inside this project makes a native component, with `<view>` and
    // a test that runs on the fake Fabric. Anything this collection does not have, a service or a
    // pipe, falls through to Angular's own. Only inside it: `--project` from the workspace root
    // does not switch collections, which is the Angular CLI's rule rather than this project's.
    cli: { schematicCollections: ['@ng-native/schematics', '@schematics/angular'] },
    schematics: Object.fromEntries(
      WEB_SPECS.map((schematic) => [`@schematics/angular:${schematic}`, { skipTests: true }]),
    ),
    architect: targets(root, name),
  };
}

/** The Commands section of the app's `AGENTS.md`, as this workspace runs them. */
function commands(name) {
  const rows = [
    [`ng serve ${name}`, 'Metro; press i or a for a simulator, or scan the QR code with Expo Go'],
    [`ng run ${name}:run-ios`, 'the iOS simulator'],
    [`ng run ${name}:run-android`, 'the Android emulator'],
    [`ng test ${name}`, 'Vitest, in Node against a fake native layer: no simulator needed'],
    [`ng build ${name}`, 'an exported bundle'],
  ];
  const width = Math.max(...rows.map(([command]) => command.length)) + 2;
  return [
    '```sh',
    ...rows.map(([command, what]) => `${command.padEnd(width)}# ${what}`),
    '```',
    '',
    '`src/main.ts` mounts the root component, `src/app/app.ts`. ' +
      `Run \`ng test ${name}\` after a change; it is fast.`,
  ].join('\n');
}

function writeFiles(tree, root, name, bundleIdentifier) {
  for (const file of native.SOURCE_FILES) {
    tree.create(path.join(root, file), native.sourceFile(file));
  }
  tree.create(path.join(root, 'app.json'), native.appJson(name, bundleIdentifier));
  tree.create(path.join(root, 'AGENTS.md'), native.agentsFile(commands(name)));
  tree.create(path.join(root, 'CLAUDE.md'), '@AGENTS.md\n');
  tree.create(path.join(root, '.gitignore'), native.GITIGNORE);
  const manifest = native.projectManifest(name, readJson(tree, 'package.json'));
  tree.create(path.join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
}

/** Adds what is missing and leaves every version the workspace already chose alone. */
function addDependencies(tree, context) {
  const manifest = readJson(tree, 'package.json');
  for (const problem of native.conflicts(manifest)) context.logger.warn(problem);
  for (const field of ['dependencies', 'devDependencies']) {
    const existing = { ...manifest.dependencies, ...manifest.devDependencies };
    const added = Object.entries(native[field]).filter(([name]) => !(name in existing));
    manifest[field] = Object.fromEntries(
      [...Object.entries(manifest[field] ?? {}), ...added].sort(([a], [b]) => (a < b ? -1 : 1)),
    );
  }
  writeJson(tree, 'package.json', manifest);
}

/** Expo's cache directory, once, wherever the project is. */
function ignoreExpo(tree) {
  if (!tree.exists('.gitignore')) return;
  const ignore = tree.readText('.gitignore');
  if (/^\.expo\/?$/m.test(ignore)) return;
  tree.overwrite('.gitignore', ignore.replace(/\n*$/, '\n\n# Expo\n.expo/\n'));
}

/**
 * @param {{ name: string, directory?: string, prefix?: string, bundleIdentifier?: string, skipInstall?: boolean }} options
 */
function application(options) {
  return (tree, context) => {
    if (!tree.exists('angular.json')) {
      throw new SchematicsException(
        'No angular.json here. This adds an app to an Angular CLI workspace; for an app on its ' +
          'own, run: npx create-expo-app@latest my-app --template @ng-native/template',
      );
    }
    const workspace = readJson(tree, 'angular.json');
    const { name } = options;
    if (workspace.projects?.[name]) {
      throw new SchematicsException(`angular.json already has a project called "${name}".`);
    }
    const root = options.directory ?? path.join(workspace.newProjectRoot ?? 'projects', name);
    const scope = readJson(tree, 'package.json').name?.match(/^@[^/]+/)?.[0];
    const bundleIdentifier = options.bundleIdentifier ?? native.bundleIdentifier(name, scope);
    const problem = native.bundleIdentifierProblem(bundleIdentifier);
    if (problem) throw new SchematicsException(problem);

    addDependencies(tree, context);
    writeFiles(tree, root, name, bundleIdentifier);
    workspace.projects = { ...workspace.projects, [name]: project(root, name, options.prefix) };
    writeJson(tree, 'angular.json', workspace);
    ignoreExpo(tree);

    if (!options.skipInstall) context.addTask(new NodePackageInstallTask());
    context.logger.info(
      `Created ${root}. Run it with: ng serve ${name} (Metro), ng run ${name}:run-ios, ` +
        `ng test ${name}, ng build ${name}.`,
    );
  };
}

module.exports = { application, targets };
