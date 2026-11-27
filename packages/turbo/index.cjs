/**
 * `@ng-native/turbo`: Angular Native's generators, for `turbo gen`.
 *
 * `turbo gen` runs the Plop generators the workspace's `turbo/generators/config.ts` registers, and
 * `ngNative(plop)` registers these four there, which `npx @ng-native/turbo init` sets up:
 *
 * - `ng-native-app`: an app, as a workspace package (`app/index.cjs`).
 * - `ng-native-library`: a library of native components (`library/index.cjs`).
 * - `ng-native-component`: a component in an app or library (`component/index.cjs`).
 * - `ng-native-sync`: the native modules an app's libraries use, listed in the app
 *   (`sync/index.cjs`).
 *
 * Each runs as one Plop action that writes its files through `files.cjs`. Turborepo passes the
 * workspace's root with the answers; outside `turbo gen` it is found from the current directory.
 */
const { workspaceFiles, findRoot } = require('./files.cjs');
const { app } = require('./app/index.cjs');
const { library } = require('./library/index.cjs');
const { component, componentTargets } = require('./component/index.cjs');
const { sync } = require('./sync/index.cjs');

/**
 * The workspace's root, from the answers `turbo gen` gives an action, or else up from where it runs.
 *
 * @param {Record<string, any>} answers
 */
function rootOf(answers) {
  const root = answers?.turbo?.paths?.root ?? findRoot(process.cwd());
  if (!root) throw new Error('No Turborepo workspace here: run turbo gen from inside one.');
  return root;
}

/**
 * A Plop action that runs `generate` on the workspace's files, with the answers. A failure's
 * message loses its full stop, since `turbo gen` follows it with one of its own and more.
 */
const action =
  (generate) =>
  /** @param {Record<string, any>} answers */
  async (answers) => {
    try {
      return await generate(workspaceFiles(rootOf(answers)), answers);
    } catch (error) {
      throw new Error(String(error instanceof Error ? error.message : error).replace(/\.$/, ''));
    }
  };

const required = (what) => (value) =>
  (typeof value === 'string' && value.trim() !== '') || `Give ${what}.`;

/** The apps and libraries a component can go in, for the component generator's prompt. */
function packageChoices() {
  const root = findRoot(process.cwd());
  if (!root) return [];
  return componentTargets(workspaceFiles(root)).map((pkg) => pkg.manifest.name);
}

/**
 * Registers Angular Native's generators with `turbo gen`.
 *
 * @param {{ setGenerator(name: string, config: object): unknown }} plop
 */
function ngNative(plop) {
  plop.setGenerator('ng-native-app', {
    description: 'An Angular Native app, rendering native iOS and Android views',
    prompts: [
      {
        type: 'input',
        name: 'directory',
        message: 'Where should the app go?',
        default: 'apps/mobile',
        validate: required('a directory, like apps/mobile'),
      },
      {
        type: 'list',
        name: 'linter',
        message: 'Add ESLint, with the rules for what does nothing on a device?',
        choices: ['none', 'eslint'],
        default: 'none',
      },
    ],
    actions: [action(app)],
  });

  plop.setGenerator('ng-native-library', {
    description: 'A library of Angular Native components, tested in Node',
    prompts: [
      {
        type: 'input',
        name: 'directory',
        message: 'Where should the library go?',
        // create-turbo already has a React library at packages/ui.
        default: 'packages/native-ui',
        validate: required('a directory, like packages/native-ui'),
      },
    ],
    actions: [action(library)],
  });

  plop.setGenerator('ng-native-component', {
    description: 'A component built from <view> and <text>, and its test, in an app or library',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'What is the component called?',
        validate: required('a name, like profile-card'),
      },
      {
        type: 'input',
        name: 'package',
        message: () => {
          const known = packageChoices();
          return `Which app or library should it go in?${known.length ? ` (${known.join(', ')})` : ''}`;
        },
        default: () => packageChoices()[0],
        validate: required('the package name of an app or library'),
      },
    ],
    actions: [action(component)],
  });

  plop.setGenerator('ng-native-sync', {
    description: 'Lists in each app the native modules its libraries use, and their config plugins',
    prompts: [],
    actions: [
      action(async (files) => {
        const { changes } = await sync(files);
        return changes.length ? changes.join('\n') : 'Every app lists the native modules it needs.';
      }),
    ],
  });
}

// Callable itself, as `index.d.ts`'s default export, and by name.
module.exports = Object.assign(ngNative, { ngNative, default: ngNative });
