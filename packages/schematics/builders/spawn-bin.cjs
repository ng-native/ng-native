/**
 * Runs a package's own CLI in an Angular Native project's directory, for the builders.
 *
 * The CLI is found from the project, not from this package, so it is the copy the app installed:
 * `expo` from wherever the workspace hoisted it. It is found the way Node looks a package up, one
 * `node_modules` at a time upwards, and not through `require.resolve`: a package's `exports` map
 * can hide its bin file, as Vitest's does, or its `package.json`.
 */
const { spawn } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

/** @param {string} name @param {string} from */
function findManifest(name, from) {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, 'node_modules', name, 'package.json');
    if (existsSync(manifest)) return manifest;
    if (dir === path.dirname(dir))
      throw new Error(`${name} is not installed, looking from ${from}.`);
  }
}

/**
 * @param {string} name the package, such as `expo`, `vitest` or `@angular/compiler-cli`
 * @param {string} from the directory to resolve it from
 * @param {string} command the entry of its `bin` to run, when not named for the package: `ngc`
 */
function resolveBin(name, from, command = name) {
  const manifestPath = findManifest(name, from);
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const file = typeof bin === 'string' ? bin : bin[command];
  return path.join(path.dirname(manifestPath), file);
}

/**
 * Where the target's project lives, as an absolute path.
 *
 * @param {import('@angular-devkit/architect').BuilderContext} context
 */
async function projectRoot(context) {
  const project = context.target?.project;
  if (!project) throw new Error('This builder runs as a project target, not on its own.');
  const metadata = await context.getProjectMetadata(project);
  return path.join(context.workspaceRoot, String(metadata['root'] ?? ''));
}

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Spawns the CLI with the terminal attached, so Metro's QR code and keyboard shortcuts work as
 * they do under `npx expo start`, and resolves when it exits.
 *
 * @param {string} name
 * @param {string[]} args
 * @param {import('@angular-devkit/architect').BuilderContext} context
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function spawnBin(name, args, context) {
  const cwd = await projectRoot(context);
  return spawnFile(resolveBin(name, cwd), args, cwd, name, context);
}

/**
 * Runs `file` with Node in `cwd`, logged and reported as `label`.
 *
 * @param {string} file
 * @param {string[]} args
 * @param {string} cwd
 * @param {string} label
 * @param {import('@angular-devkit/architect').BuilderContext} context
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
function spawnFile(file, args, cwd, label, context) {
  context.logger.info(
    `${[label, ...args].join(' ')}  (in ${path.relative(context.workspaceRoot, cwd)})`,
  );
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], { cwd, stdio: 'inherit' });
    // Ctrl-C reaches the whole process group, but a supervisor, CI or an IDE's task runner signals
    // `ng` alone, and Metro would outlive it on its port. So a stop is passed on.
    const stop = (signal) => child.kill(signal);
    for (const signal of SIGNALS) process.on(signal, stop);
    const settle = (result) => {
      for (const signal of SIGNALS) process.off(signal, stop);
      resolve(result);
    };
    child.on('error', (error) => settle({ success: false, error: error.message }));
    child.on('exit', (code, signal) =>
      settle(
        code === 0
          ? { success: true }
          : { success: false, error: `${label} exited with ${signal ?? `code ${code}`}` },
      ),
    );
  });
}

module.exports = { resolveBin, projectRoot, spawnBin, spawnFile };
