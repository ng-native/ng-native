/**
 * The version the Release workflow releases, checked before any of its slow jobs start.
 *
 * Its inputs are a bump (`minor` or `patch`) and an optional exact version, which takes precedence
 * over the bump. An exact version must be a plain semver version, on the major already released
 * (a new major is a decision, not a typo to publish), and above the highest version any released
 * package has on npm. The one exception is that highest version itself while it is above the
 * version on disk: `main` gets the release commit only once every package is published, so that is
 * a release that failed part way through, run again with the same version to finish it.
 *
 * Usage:
 *
 *   node scripts/release-version.mjs <bump> [exact version]
 *
 * Prints the version or bump to give `nx release version`, and writes it to the step's outputs as
 * `version`. Exits non-zero with the reason when the inputs are refused.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BUMPS = ['minor', 'patch'];

// semver.org's grammar, without build metadata: npm drops it, so two versions would publish as one.
const IDENTIFIER = '(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)';
const VERSION = new RegExp(
  `^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?$`,
);

/** A version's numbers and prerelease identifiers, or null when it is not a semver version. */
function parse(version) {
  const match = VERSION.exec(version);
  if (!match) return null;
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split('.') ?? [],
  };
}

/** How two prerelease identifiers order: numeric ones by value and before alphanumeric ones. */
function compareIdentifiers(x, y) {
  const [xNumber, yNumber] = [/^\d+$/.test(x), /^\d+$/.test(y)];
  if (xNumber && yNumber) return Number(x) - Number(y);
  if (xNumber !== yNumber) return xNumber ? -1 : 1;
  return x === y ? 0 : x < y ? -1 : 1;
}

/** Negative, zero or positive as `a` is below, equal to or above `b`, by semver precedence. */
export function compare(a, b) {
  const [left, right] = [parse(a), parse(b)];
  for (let at = 0; at < 3; at++) {
    if (left.core[at] !== right.core[at]) return left.core[at] - right.core[at];
  }
  // A prerelease comes before its release: 0.19.0-rc.0 < 0.19.0.
  if (!left.prerelease.length || !right.prerelease.length) {
    return right.prerelease.length - left.prerelease.length;
  }
  // Identifier by identifier, and a shorter list first when one starts the other.
  for (let at = 0; at < Math.min(left.prerelease.length, right.prerelease.length); at++) {
    const order = compareIdentifiers(left.prerelease[at], right.prerelease[at]);
    if (order) return order;
  }
  return left.prerelease.length - right.prerelease.length;
}

/**
 * The version or bump to release, from the workflow's inputs, every version the released packages
 * have on npm, and the version on disk. Throws with the reason when the inputs are refused.
 */
export function releaseVersion(bump, exact, published, current) {
  const highest = published.filter(parse).reduce((a, b) => (compare(a, b) >= 0 ? a : b), '0.0.0');

  exact = exact.trim();
  if (!exact) {
    if (!BUMPS.includes(bump)) {
      throw new Error(`The bump must be ${BUMPS.join(' or ')}, not "${bump}".`);
    }
    return bump;
  }

  const version = parse(exact);
  if (!version) {
    throw new Error(
      `"${exact}" is not a version: give one such as 0.19.0 or 0.19.0-rc.0, without a "v" or build metadata.`,
    );
  }
  const major = parse(highest).core[0];
  if (version.core[0] > major) {
    throw new Error(
      `${exact} is a new major version, and releases stay on ${major}.x: the latest published is ${highest}. Give a ${major}.x version above it, or leave the version empty to bump.`,
    );
  }
  const order = compare(exact, highest);
  if (order === 0) {
    // Finishing a release that failed part way through.
    if (compare(exact, current) > 0) return exact;
    throw new Error(
      `${exact} is already released. Give a version above it, or leave the version empty to bump.`,
    );
  }
  if (order < 0) {
    throw new Error(
      `${exact} is not above ${highest}, the latest published. Give a version above it, or leave the version empty to bump.`,
    );
  }
  return exact;
}

/** The versions `name` has on npm: none before its first publish. */
function versionsOnNpm(name) {
  try {
    const versions = JSON.parse(
      execFileSync('npm', ['view', name, 'versions', '--json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
    // A package with one version prints it as a string.
    return [versions].flat();
  } catch (error) {
    if (`${error.stdout}${error.stderr}`.includes('E404')) return [];
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [bump = '', exact = ''] = process.argv.slice(2);
  // The packages `nx release` versions, so the two lists cannot drift apart.
  const { release } = JSON.parse(readFileSync(path.join(root, 'nx.json'), 'utf8'));
  const published = release.projects.flatMap(versionsOnNpm);
  // Every package moves in lockstep, so any one's version is the last finished release.
  const { version: current } = JSON.parse(
    readFileSync(path.join(root, 'packages/fabric/package.json'), 'utf8'),
  );
  try {
    const version = releaseVersion(bump, exact, published, current);
    console.log(version);
    if (process.env['GITHUB_OUTPUT']) {
      appendFileSync(process.env['GITHUB_OUTPUT'], `version=${version}\n`);
    }
  } catch (error) {
    // An annotation, so the reason shows on the run's summary page.
    console.error(process.env['GITHUB_ACTIONS'] ? `::error::${error.message}` : error.message);
    process.exitCode = 1;
  }
}
