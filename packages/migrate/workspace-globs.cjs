/**
 * The package manager's workspaces, which decide whether a directory is a workspace package, for
 * `@ng-native/nx`'s app generator and `@ng-native/turbo`'s generators.
 *
 * An app outside every workspace glob is not a workspace package: pnpm installs nothing for it,
 * and its `metro.config.js` cannot find Expo. Nx's own TypeScript preset starts with `packages/*`
 * only, so an app in `apps/` is outside it until the glob is added.
 */
const { minimatch } = require('minimatch');

/**
 * The workspace's files: an Nx `Tree`, or `@ng-native/turbo`'s view of the disk.
 *
 * @typedef {object} Files
 * @property {(file: string) => boolean} exists
 * @property {(file: string, encoding: 'utf-8') => string | null} read
 * @property {(file: string, content: string) => void} write
 * @property {(dir: string) => string[]} children
 */

/** One YAML scalar as written: quoted, with its quotes taken off, or bare, before any comment. */
function scalar(text) {
  const quoted = /^(['"])(.*?)\1/.exec(text);
  return quoted ? quoted[2] : text.replace(/(?:^|[ \t])#.*$/, '').trim();
}

/**
 * The `packages:` list of a `pnpm-workspace.yaml`, as written: one quoted or bare glob a line, with
 * comment and blank lines among them, or a flow list, on one line or several. Line endings may be
 * `\r\n`.
 */
function pnpmGlobs(yaml) {
  const text = yaml.replace(/\r\n?/g, '\n');
  const flow = /^packages:[ \t]*\[([^\]]*)\]/m.exec(text)?.[1];
  if (flow !== undefined) {
    // Each entry, quoted (where a comma is part of the glob) or bare, past the comments a list
    // over several lines can have.
    const entries = flow.replace(/(^|[ \t])#[^\n]*/g, '$1');
    return [...entries.matchAll(/'([^']*)'|"([^"]*)"|([^,\s'"][^,]*)/g)]
      .map((match) => match[1] ?? match[2] ?? match[3].trim())
      .filter(Boolean);
  }
  const key = /^packages:[ \t]*(?:#.*)?$/m.exec(text);
  if (!key) return [];
  const found = [];
  for (const line of text.slice(key.index + key[0].length + 1).split('\n')) {
    const entry = /^[ \t]+-[ \t]*(.*)$/.exec(line);
    if (entry) {
      const glob = scalar(entry[1]);
      if (glob) found.push(glob);
    } else if (!/^(?:[ \t]*|[ \t]+#.*)$/.test(line)) break;
  }
  return found;
}

const PNPM = 'pnpm-workspace.yaml';

const readJson = (files, file) => JSON.parse(files.read(file, 'utf-8') ?? '{}');

function manifestGlobs(files) {
  const { workspaces } = readJson(files, 'package.json');
  return Array.isArray(workspaces) ? workspaces : (workspaces?.packages ?? []);
}

/**
 * The workspace's globs: the `packages:` of its `pnpm-workspace.yaml`, or the `workspaces` of its
 * root `package.json`, each without a leading `./`.
 *
 * @param {Files} files
 * @returns {string[]}
 */
function globs(files) {
  const all = files.exists(PNPM)
    ? pnpmGlobs(files.read(PNPM, 'utf-8') ?? '')
    : manifestGlobs(files);
  // `./apps/*` names what `apps/*` does, and directories are matched without the `./`.
  return all.map((glob) => glob.replace(/^(!?)(?:\.\/)+/, '$1'));
}

/**
 * Whether the workspace has package-manager workspaces at all. A `pnpm-workspace.yaml` with no
 * `packages:` list does not: pnpm 11 writes one to hold settings alone, in an integrated
 * workspace like the `angular-monorepo` preset's.
 */
function usesWorkspaces(files) {
  return globs(files).length > 0;
}

/**
 * Adds the app's directory when no glob already covers it: as `<parent>/*` when that takes in
 * nothing else, as Nx adds its own projects, and as the directory itself when a sibling already
 * has a `package.json`, which the workspace either lists one by one or has left out.
 *
 * @param {Files} files
 * @param {string} directory
 */
function includeInWorkspaces(files, directory) {
  const all = globs(files);
  // A negated glob excludes; it never makes a directory a workspace package.
  const excluded = all.find((glob) => glob.startsWith('!') && minimatch(directory, glob.slice(1)));
  if (excluded) {
    throw new Error(
      `The workspace excludes ${directory} with ${excluded}, so it would not be a workspace ` +
        'package. Choose another directory, or remove the exclusion first.',
    );
  }
  if (all.some((glob) => !glob.startsWith('!') && minimatch(directory, glob))) return;
  const parent = directory.includes('/') ? directory.slice(0, directory.lastIndexOf('/')) : '';
  const siblings = parent ? files.children(parent).map((child) => `${parent}/${child}`) : [];
  const alone = !siblings.some((dir) => dir !== directory && files.exists(`${dir}/package.json`));
  const glob = parent && alone ? `${parent}/*` : directory;
  if (files.exists(PNPM)) addToPnpmWorkspace(files, glob);
  else addToManifestWorkspaces(files, glob);
}

/** Adds `glob` to the `packages:` of `pnpm-workspace.yaml`, starting the list where it has none. */
function addToPnpmWorkspace(files, glob) {
  const yaml = files.read(PNPM, 'utf-8') ?? '';
  // A flow list, `packages: ['apps/*']`, is edited by hand rather than rewritten as text.
  if (/^packages:[ \t]*\[/m.test(yaml)) {
    throw new Error(
      `${PNPM} lists its packages on one line. Add '${glob}' to it, then run this again.`,
    );
  }
  // The file's own line ending, and the key's comment, if it has one, stay as they are.
  const eol = yaml.includes('\r\n') ? '\r\n' : '\n';
  const key = /^packages:[ \t]*(?:#[^\r\n]*)?(?=\r?$)/m;
  const next = key.test(yaml)
    ? yaml.replace(key, (line) => `${line}${eol}  - '${glob}'`)
    : `packages:${eol}  - '${glob}'${eol}${yaml}`;
  files.write(PNPM, next);
}

/**
 * Adds `glob` to the `workspaces` of the root `package.json`, a list or an object with `packages`,
 * starting the list, as npm, Yarn and Bun write it, where the root has none.
 */
function addToManifestWorkspaces(files, glob) {
  const manifest = readJson(files, 'package.json');
  if (!manifest.workspaces) manifest.workspaces = [glob];
  else if (Array.isArray(manifest.workspaces)) manifest.workspaces.push(glob);
  else manifest.workspaces.packages = [...(manifest.workspaces.packages ?? []), glob];
  files.write('package.json', JSON.stringify(manifest, null, 2) + '\n');
}

module.exports = { pnpmGlobs, globs, usesWorkspaces, includeInWorkspaces };
