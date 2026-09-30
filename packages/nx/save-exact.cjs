/**
 * Whether the workspace saves exact versions, and the dependencies written that way when it does.
 *
 * Each package manager has its own setting for it, and a generator that writes ranges into such a
 * workspace lets the app's Angular and TypeScript drift from the versions the rest of it pins.
 */
const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const semver = require('semver');

/** The rest of a line, which in YAML and TOML may end in a comment. */
const END = String.raw`[ \t]*(#.*)?$`;

const SETTINGS = {
  'pnpm-workspace.yaml': [
    new RegExp(`^saveExact:[ \\t]*true${END}`, 'm'),
    new RegExp(`^savePrefix:[ \\t]*(''|"")${END}`, 'm'),
  ],
  '.npmrc': [
    /^[ \t]*save-exact[ \t]*=[ \t]*true[ \t]*$/m,
    /^[ \t]*save-prefix[ \t]*=[ \t]*(''|"")?[ \t]*$/m,
  ],
  '.yarnrc': [new RegExp(`^save-prefix[ \\t]+(''|"")${END}`, 'm')],
  '.yarnrc.yml': [new RegExp(`^defaultSemverRangePrefix:[ \\t]*(''|"")${END}`, 'm')],
  'bunfig.toml': [new RegExp(`^[ \\t]*exact[ \\t]*=[ \\t]*true${END}`, 'm')],
};

/** @param {import('@nx/devkit').Tree} tree */
function savesExact(tree) {
  return Object.entries(SETTINGS).some(
    ([file, patterns]) =>
      tree.exists(file) && patterns.some((pattern) => pattern.test(tree.read(file, 'utf-8') ?? '')),
  );
}

/**
 * The registry, as npm sees it from the workspace's root, so a registry set in its `.npmrc` is the
 * one asked. Replaced in tests, which never reach the network.
 */
const registry = {
  /**
   * @param {string} name
   * @param {string} cwd
   * @returns {Promise<string[]>}
   */
  async versions(name, cwd) {
    // A command line rather than arguments, which Windows needs to run `npm.cmd`. The name is one
    // of this package's own dependencies, and the range, whose `^` cmd.exe would eat, stays out.
    const { stdout } = await promisify(exec)(`npm view ${name} versions --json`, {
      cwd,
      timeout: 10_000,
      windowsHide: true,
    });
    return [JSON.parse(stdout)].flat();
  },
};

/**
 * The version `pnpm add` saves for a range with exact versions on: the newest the registry has
 * that the range allows, or the lowest it allows when the registry cannot be reached.
 *
 * @param {import('@nx/devkit').Tree} tree
 * @param {string} name
 * @param {string} range
 */
async function newest(tree, name, range) {
  if (semver.valid(range) || !semver.validRange(range)) return range;
  const floor = semver.minVersion(range)?.version ?? range;
  try {
    return semver.maxSatisfying(await registry.versions(name, tree.root), range) ?? floor;
  } catch {
    return floor;
  }
}

/**
 * The range an Angular package resolves within: also the root's `@angular/core`, where the two
 * overlap, since every Angular package peers on the others at exactly its own version.
 *
 * @param {import('@nx/devkit').Tree} tree
 * @param {string} name
 * @param {string} range
 */
function withinAngular(tree, name, range) {
  if (!name.startsWith('@angular/') || !tree.exists('package.json')) return range;
  const { dependencies, devDependencies } = JSON.parse(tree.read('package.json', 'utf-8') ?? '{}');
  const core = { ...devDependencies, ...dependencies }['@angular/core'];
  if (!core || !semver.validRange(core) || !semver.validRange(range)) return range;
  // Alternative by alternative, as joining two ranges with `||` in them would let either side's
  // other alternatives through on their own.
  const alternatives = (one) => semver.validRange(one).split('||');
  const both = alternatives(range).flatMap((ours) =>
    alternatives(core)
      .filter((theirs) => semver.intersects(ours, theirs))
      .map((theirs) => `${ours} ${theirs}`),
  );
  return both.length ? both.join(' || ') : range;
}

/**
 * Each range as the exact version it resolves to when the workspace saves exact versions, and as
 * it is otherwise. The packages in `settled`, which take a version the workspace already has, are
 * left as they are.
 *
 * @param {import('@nx/devkit').Tree} tree
 * @param {Record<string, string>} dependencies
 * @param {Iterable<string>} [settled]
 * @returns {Promise<Record<string, string>>}
 */
async function asSaved(tree, dependencies, settled = []) {
  if (!savesExact(tree)) return dependencies;
  const skip = new Set(settled);
  return Object.fromEntries(
    await Promise.all(
      Object.entries(dependencies).map(async ([name, range]) => [
        name,
        skip.has(name) ? range : await newest(tree, name, withinAngular(tree, name, range)),
      ]),
    ),
  );
}

module.exports = { savesExact, asSaved, registry };
