/**
 * The workspace's files, read and written on disk from its root, with the methods the generators
 * share with `@ng-native/nx`'s `Tree`: `exists`, `read` and `root`, which `@ng-native/migrate`'s
 * exact-version check takes, and JSON reads and writes beside them.
 *
 * Paths are relative to the root, with `/` on every OS, as a `Tree`'s are.
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {string} root the workspace's root, where its `turbo.json` is
 */
function workspaceFiles(root) {
  const at = (file) => path.join(root, ...file.split('/'));
  /** The files written, in order, for the message a generator ends with. */
  const written = [];
  const files = {
    root,
    written,
    /** @param {string} file */
    exists: (file) => fs.existsSync(at(file)),
    /**
     * @param {string} file
     * @param {'utf-8'} [encoding]
     * @returns {string | null}
     */
    read: (file, encoding = 'utf-8') =>
      fs.existsSync(at(file)) ? fs.readFileSync(at(file), encoding) : null,
    /**
     * @param {string} file
     * @param {string} content
     */
    write(file, content) {
      fs.mkdirSync(path.dirname(at(file)), { recursive: true });
      fs.writeFileSync(at(file), content);
      if (!written.includes(file)) written.push(file);
    },
    /** The names in a directory, or none when it does not exist. @param {string} dir */
    children: (dir) =>
      fs.existsSync(at(dir)) && fs.statSync(at(dir)).isDirectory() ? fs.readdirSync(at(dir)) : [],
    /** @param {string} file */
    isDirectory: (file) => fs.existsSync(at(file)) && fs.statSync(at(file)).isDirectory(),
    /** @param {string} file */
    readJson: (file) => JSON.parse(files.read(file) ?? 'null'),
    /**
     * Written as Prettier writes JSON, two spaces and a final newline.
     *
     * @param {string} file
     * @param {unknown} value
     */
    writeJson: (file, value) => files.write(file, JSON.stringify(value, null, 2) + '\n'),
    /**
     * @param {string} file
     * @param {(value: any) => unknown} update
     */
    updateJson: (file, update) => files.writeJson(file, update(files.readJson(file))),
  };
  return files;
}

/**
 * The workspace root above `from`: the nearest directory with a root `turbo.json` or `turbo.jsonc`,
 * or with a `pnpm-workspace.yaml` or a `package.json` listing `workspaces` when there is neither yet.
 *
 * A package's own `turbo.json`, which `extends` the root's, as every app the generator writes has,
 * is passed over: taking it for the root made the app its own workspace, with no libraries.
 *
 * @param {string} from
 * @returns {string | undefined}
 */
function findRoot(from) {
  let fallback;
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    if (['turbo.json', 'turbo.jsonc'].some((file) => isRootTurboJson(path.join(dir, file)))) {
      return dir;
    }
    if (!fallback && isWorkspaceRoot(dir)) fallback = dir;
    if (dir === path.dirname(dir)) return fallback;
  }
}

/** Whether `file` is a workspace's `turbo.json` or `turbo.jsonc`: one that does not extend another. */
function isRootTurboJson(file) {
  if (!fs.existsSync(file)) return false;
  try {
    return !('extends' in JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    // A `turbo.json` with comments, which Turborepo allows, read as text.
    return !/"extends"\s*:/.test(fs.readFileSync(file, 'utf8'));
  }
}

function isWorkspaceRoot(dir) {
  if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return true;
  const manifest = path.join(dir, 'package.json');
  if (!fs.existsSync(manifest)) return false;
  try {
    return Boolean(JSON.parse(fs.readFileSync(manifest, 'utf8')).workspaces);
  } catch {
    return false;
  }
}

module.exports = { workspaceFiles, findRoot };
