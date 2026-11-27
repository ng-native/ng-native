/**
 * What the generators read of the workspace around them: its package manager, its npm scope, and
 * its packages, which are the directories its workspace globs name that have a `package.json`.
 */
const { minimatch } = require('minimatch');
const { globs } = require('@ng-native/migrate/workspace-globs.cjs');

/** @typedef {ReturnType<typeof import('./files.cjs').workspaceFiles>} Files */

/**
 * @typedef {object} WorkspacePackage
 * @property {string} dir its directory, from the workspace root
 * @property {Record<string, any>} manifest its `package.json`
 */

/** The lockfile each package manager writes, for a workspace whose `package.json` names none. */
const LOCKFILES = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
  'package-lock.json': 'npm',
};

/**
 * The workspace's package manager: the one its `packageManager` field names, which Turborepo
 * requires, or the one whose lockfile it has.
 *
 * @param {Files} files
 * @returns {'pnpm' | 'npm' | 'yarn' | 'bun'}
 */
function packageManager(files) {
  const named = files.readJson('package.json')?.packageManager?.split('@')[0];
  if (['pnpm', 'npm', 'yarn', 'bun'].includes(named)) return named;
  for (const [file, manager] of Object.entries(LOCKFILES)) {
    if (files.exists(file)) return /** @type {'pnpm' | 'npm' | 'yarn' | 'bun'} */ (manager);
  }
  if (files.exists('pnpm-workspace.yaml')) return 'pnpm';
  return 'npm';
}

/**
 * How the workspace's package manager runs a command, for the messages and the `AGENTS.md` the
 * generators write.
 *
 * @param {'pnpm' | 'npm' | 'yarn' | 'bun'} manager
 */
function commandsFor(manager) {
  const turbo = `${{ pnpm: 'pnpm', npm: 'npx', yarn: 'yarn', bun: 'bunx' }[manager]} turbo`;
  return {
    /** `turbo run <task> --filter=<name>`, through the workspace's own `turbo`. */
    turbo: (task, name) => `${turbo} run ${task}` + (name ? ` --filter=${name}` : ''),
    /** `turbo gen <generator>`. */
    gen: (generator) => `${turbo} gen ${generator}`,
    /** A script of one package, run in the foreground, where Expo's keyboard shortcuts work. */
    script: (name, script) =>
      ({
        pnpm: `pnpm --filter ${name} ${script}`,
        npm: `npm run ${script} -w ${name}`,
        yarn: `yarn workspace ${name} ${script}`,
        bun: `bun run --filter ${name} ${script}`,
      })[manager],
    install: { pnpm: 'pnpm install', npm: 'npm install', yarn: 'yarn', bun: 'bun install' }[
      manager
    ],
  };
}

/**
 * The npm scope a new package is named under, `@repo`: the root `package.json`'s, or, where the
 * root has none, the one the workspace's scoped packages share. `create-turbo` names its root
 * `my-turborepo` and its packages `@repo/ui` and the like, so the second is the usual one.
 * Undefined when the root is unscoped and its packages have no scope, or more than one.
 *
 * @param {Files} files
 * @returns {string | undefined}
 */
function scope(files) {
  const own = scopeOf(files.readJson('package.json')?.name);
  if (own) return own;
  const shared = new Set(
    workspacePackages(files)
      .map((pkg) => scopeOf(pkg.manifest?.name))
      .filter(Boolean),
  );
  return shared.size === 1 ? [...shared][0] : undefined;
}

/** @param {unknown} name */
function scopeOf(name) {
  return typeof name === 'string' ? name.match(/^@[^/]+(?=\/)/)?.[0] : undefined;
}

/**
 * The package name a directory gives, under the workspace's scope, or why it cannot be one: npm
 * takes lowercase letters, digits, `-`, `.` and `_`, starting with a letter or digit.
 *
 * @param {Files} files
 * @param {string} directory
 */
function packageName(files, directory) {
  const name = directory.slice(directory.lastIndexOf('/') + 1);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new Error(
      `${directory} cannot name a package: npm takes lowercase letters, digits, -, . and _. ` +
        'Choose another directory.',
    );
  }
  const workspaceScope = scope(files);
  return { name, workspaceScope, packageName: workspaceScope ? `${workspaceScope}/${name}` : name };
}

/**
 * The workspace's packages: each directory a glob names that has a `package.json`, less those a
 * negated glob excludes. A glob is matched against directories as deep as it reaches, and at any
 * depth for one with `**`, skipping `node_modules` and hidden directories.
 *
 * @param {Files} files
 * @returns {WorkspacePackage[]}
 */
function workspacePackages(files) {
  const all = globs(files);
  const including = all.filter((glob) => !glob.startsWith('!'));
  const excluding = all.filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1));
  const depth = Math.max(
    0,
    ...including.map((glob) => (glob.includes('**') ? Infinity : glob.split('/').length)),
  );
  /** @type {WorkspacePackage[]} */
  const found = [];
  const visit = (dir, level) => {
    if (level > depth) return;
    for (const child of files.children(dir)) {
      if (child === 'node_modules' || child.startsWith('.')) continue;
      const path = dir ? `${dir}/${child}` : child;
      if (!files.isDirectory(path)) continue;
      const matches = (glob) => minimatch(path, glob.replace(/\/$/, ''));
      if (
        files.exists(`${path}/package.json`) &&
        including.some(matches) &&
        !excluding.some(matches)
      ) {
        found.push({ dir: path, manifest: files.readJson(`${path}/package.json`) });
      }
      visit(path, level + 1);
    }
  };
  visit('', 1);
  return found;
}

/** The dependencies a manifest lists, of every kind but its dev dependencies. */
function runtimeDependencies(manifest) {
  return {
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
    ...manifest.dependencies,
  };
}

/** Every package a manifest lists, by name, with the range it lists. */
function listed(manifest) {
  return { ...manifest.devDependencies, ...manifest.peerDependencies, ...manifest.dependencies };
}

/**
 * Whether a workspace package is an Angular Native app: an Expo app, with an `app.json`, that runs
 * on `@ng-native/platform`.
 *
 * @param {Files} files
 * @param {WorkspacePackage} pkg
 */
function isNativeApp(files, pkg) {
  return files.exists(`${pkg.dir}/app.json`) && '@ng-native/platform' in listed(pkg.manifest);
}

/**
 * Whether a workspace package is a library of Angular Native components: not an app, and lists
 * `@ng-native/components`.
 *
 * @param {Files} files
 * @param {WorkspacePackage} pkg
 */
function isNativeLibrary(files, pkg) {
  return !files.exists(`${pkg.dir}/app.json`) && '@ng-native/components' in listed(pkg.manifest);
}

/**
 * The lowest Metro port no other Expo app in the workspace listens on, so that `turbo run dev`
 * can run them together: two on Expo's default race for it, and the second dies with
 * `EADDRINUSE`. Each `expo start` an app's scripts run takes the port its `--port` names, or
 * Expo's default without one, and an Expo app with no such script has the default too.
 *
 * @param {Files} files
 * @param {number} defaultPort
 */
function metroPort(files, defaultPort) {
  const taken = new Set();
  for (const pkg of workspacePackages(files)) {
    if (!files.exists(`${pkg.dir}/app.json`)) continue;
    const starts = Object.values(pkg.manifest.scripts ?? {}).filter(
      (script) => typeof script === 'string' && /\bexpo start\b/.test(script),
    );
    for (const script of starts) {
      // Each `expo start`'s own arguments, up to the end of its command: a `--port` another
      // command takes, `node server.js --port 3000` beside it under `concurrently`, is not Metro's.
      for (const [, args] of script.matchAll(/\bexpo start\b([^'"&|;\n]*)/g)) {
        taken.add(Number(args.match(/--port[= ](\d+)/)?.[1] ?? defaultPort));
      }
    }
    if (!starts.length) taken.add(defaultPort);
  }
  let port = defaultPort;
  while (taken.has(port)) port++;
  return port;
}

module.exports = {
  packageManager,
  commandsFor,
  scope,
  packageName,
  workspacePackages,
  runtimeDependencies,
  listed,
  isNativeApp,
  isNativeLibrary,
  metroPort,
};
