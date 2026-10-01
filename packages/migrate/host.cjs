/**
 * What a migration reads and writes: an app's files, through whichever tool runs it.
 *
 * `nx migrate` hands a migration an Nx `Tree`, `ng update` an Angular schematics `Tree`, and the
 * `ng-native-migrate` command the app's own directory. Each is turned into a host with these
 * three methods, so a migration is written once and runs the same under all three. Paths are
 * relative to the workspace root, with `/` between segments and no leading `/`.
 *
 * @typedef {object} Host
 * @property {(path: string) => string | null} read The file's text, or null when there is none.
 * @property {(path: string, text: string) => void} write Creates the file or replaces it.
 * @property {(dir: string) => { files: string[], dirs: string[] }} list The names in a directory.
 */

/**
 * Directories no migration looks in: installed packages, native projects' build output and pods,
 * and anything hidden (`.git`, `.nx`, `.angular`, `.expo`).
 */
const SKIPPED = new Set(['node_modules', 'dist', 'build', 'Pods']);

/**
 * Every file in the workspace a migration may change, outside the directories above.
 *
 * @param {Host} host
 * @param {string} [dir]
 * @returns {Generator<string>}
 */
function* files(host, dir = '') {
  const { files: names, dirs } = host.list(dir);
  for (const name of names) yield dir ? `${dir}/${name}` : name;
  for (const name of dirs) {
    if (SKIPPED.has(name) || name.startsWith('.')) continue;
    yield* files(host, dir ? `${dir}/${name}` : name);
  }
}

module.exports = { files };
