/**
 * Every workspace project whose dependencies need Babel 7 or TypeScript 6 as a peer declares it, and
 * gets that version for every dependency that takes it.
 *
 * pnpm installs a peer a project does not declare itself, and it picks the newest version anywhere
 * in the workspace, whatever range the peer asks for. React Native's Babel packages peer on any
 * `@babel/core`, and `@angular/compiler-cli` brings `@babel/core` 8, so a project that does not
 * declare Babel 7 gets React Native on Babel 8 the next time anything re-resolves the lockfile:
 * adding a dependency to any package is enough. That puts React Native in the workspace twice, once
 * per Babel, with React Native's Babel 7 plugins on a Babel they do not support. Nx's and Expo's
 * TypeScript peers drift the same way, to TypeScript 7, which has no JavaScript API for Nx to read a
 * tsconfig with. Expo in two variants, one per TypeScript, also leaves the packages that depend on
 * it (`expo-image`, `expo-sqlite`) on whichever variant pnpm resolves first, which every change to
 * the lockfile swaps. A project that declares the peer keeps the version it declares, and so does
 * an optional peer it declares as well, such as `@ng-native/metro`'s `@expo/metro-config`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Each importer in the lockfile, with the resolved version of each of its dependencies. */
function importers(): Map<string, Map<string, string>> {
  const lines = readFileSync(`${root}pnpm-lock.yaml`, 'utf8').split('\n');
  const result = new Map<string, Map<string, string>>();
  let importer: Map<string, string> | null = null;
  let dependency = '';
  let inImporters = false;
  for (const line of lines) {
    if (/^\S/.test(line)) inImporters = line === 'importers:';
    if (!inImporters) continue;
    const project = /^ {2}(\S+):$/.exec(line);
    const name = /^ {6}'?([^':]+)'?:$/.exec(line);
    const version = /^ {8}version: (.+)$/.exec(line);
    if (project) result.set(project[1]!, (importer = new Map()));
    else if (name) dependency = name[1]!;
    else if (version && importer) importer.set(dependency, version[1]!);
  }
  return result;
}

function declared(project: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(`${root}${project}/package.json`, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return { ...manifest.dependencies, ...manifest.devDependencies };
}

/** A peer, and the major version every project needs it at. */
const PEERS: { peer: string; major: number }[] = [
  { peer: '@babel/core', major: 7 },
  { peer: 'typescript', major: 6 },
];

describe('the peers a workspace project needs', () => {
  for (const { peer, major } of PEERS) {
    it(`declares ${peer} ${major} wherever a dependency needs it as a peer`, () => {
      const resolved = new RegExp(`\\(${peer}@(\\d+)\\.`, 'g');
      const missing: string[] = [];
      for (const [project, dependencies] of importers()) {
        const majors = [...dependencies.values()].flatMap((version) =>
          [...version.matchAll(resolved)].map((match) => Number(match[1])),
        );
        const range = declared(project)[peer];
        const declaresMajor = range?.match(new RegExp(`^[~^]?${major}\\.`));
        if (majors.length && (!declaresMajor || majors.some((found) => found !== major))) {
          missing.push(project);
        }
      }
      assert.deepEqual(missing, [], `these projects leave ${peer} for pnpm to pick`);
    });
  }
});

/**
 * Vite takes `jiti` as an optional peer, and `packages/integration-tests` also has the `jiti` 1
 * that Tailwind 3 depends on. Without its own `jiti` 2 its Vite resolves the peer to 1, a second
 * Vite variant, and Vitest's plugins, whose lockfile keys do not say which Vite they are on, can
 * swap between the two variants whenever anything re-resolves the lockfile.
 */
it('resolves Vite to one variant across the workspace', () => {
  const lockfile = readFileSync(`${root}pnpm-lock.yaml`, 'utf8');
  const variants = lockfile.match(/^ {2}vite@[^(:]+\(.*:$/gm) ?? [];
  assert.equal(variants.length, 1, variants.join('\n'));
});

type Graph = { optionalPeers: Map<string, Set<string>>; children: Map<string, string[]> };

const add = <T>(map: Map<string, Set<T>>, key: string, value: T) =>
  map.set(key, (map.get(key) ?? new Set()).add(value));

/** The lockfile's `packages` and `snapshots` sections, as the graph of what depends on what. */
function graph(): Graph {
  const lines = readFileSync(`${root}pnpm-lock.yaml`, 'utf8').split('\n');
  const result: Graph = { optionalPeers: new Map(), children: new Map() };
  const at = { section: '', key: '', block: '', peer: '' };
  for (const line of lines) {
    if (/^\S/.test(line)) at.section = line.replace(/:.*$/, '');
    const entry = /^ {2}'?([^' ].*?)'?:( \{\})?$/.exec(line);
    const field = /^ {4}(\w+):$/.exec(line);
    if (entry) at.key = entry[1]!;
    if (entry && at.section === 'snapshots') result.children.set(at.key, []);
    if (field) at.block = field[1]!;
    if (!entry && !field) readItem(line, at, result);
  }
  return result;
}

/** One line under a `packages` or `snapshots` entry: a peer's meta, or a dependency. */
function readItem(line: string, at: Record<string, string>, { optionalPeers, children }: Graph) {
  const item = /^ {6}'?([^': ][^':]*)'?:(?: (.+))?$/.exec(line);
  if (at.block === 'peerDependenciesMeta') {
    if (item) at.peer = item[1]!;
    else if (/^ {8}optional: true$/.test(line)) add(optionalPeers, at.key!, at.peer!);
  } else if (item?.[2] && at.section === 'snapshots' && /ependencies$/.test(at.block!)) {
    children.get(at.key!)!.push(childKey(item[1]!, item[2]));
  }
}

/** The snapshot a dependency resolves to: `name@version`, or the version itself for an alias. */
function childKey(name: string, version: string) {
  return /^@?[^@(]+@\d/.test(version) ? version : `${name}@${version}`;
}

/** `name@version` without the peers in brackets after it. */
const base = (key: string) => key.replace(/\(.*$/, '');
const nameOf = (key: string) => base(key).replace(/(.)@[^@]*$/, '$1');

/** Each package a project reaches, with the packages it is reached through. */
function reached(project: string, dependencies: Map<string, string>, { children }: Graph) {
  const direct = [...dependencies]
    .filter(([, version]) => !version.startsWith('link:'))
    .map(([name, version]) => childKey(name, version));
  const parents = new Map<string, Set<string>>(direct.map((key) => [key, new Set([project])]));
  const queue = [...direct];
  for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
    for (const child of children.get(key) ?? []) {
      if (!parents.has(child)) queue.push(child);
      add(parents, child, key);
    }
  }
  return parents;
}

/**
 * The optional peers a project's packages resolve that neither the project nor a package above
 * them depends on, where the project's packages hold more than one version of the peer.
 */
function unsettledPeers(
  project: string,
  dependencies: Map<string, string>,
  graph: Graph,
  declares: Record<string, string> = declared(project),
) {
  const parents = reached(project, dependencies, graph);
  const versions = new Map<string, Set<string>>();
  for (const key of parents.keys()) add(versions, nameOf(key), base(key));
  const provides = (parent: string, name: string) =>
    (graph.children.get(parent) ?? []).some((child) => nameOf(child) === name);
  // Whether every path from the project down to `key` passes a package that depends on `peer`,
  // which pnpm resolves the peer from. A cycle counts as a path without one.
  const settled = (key: string, peer: string, path: Set<string> = new Set()): boolean =>
    [...(parents.get(key) ?? [])].every(
      (parent) =>
        parent !== project &&
        !path.has(parent) &&
        (provides(parent, peer) || settled(parent, peer, new Set(path).add(key))),
    );
  return [...parents.keys()].flatMap((key) =>
    [...(graph.optionalPeers.get(base(key)) ?? [])]
      .filter((peer) => key.includes(`(${peer}@`) && (versions.get(peer)?.size ?? 0) > 1)
      // The project is above every package it reaches, so a peer it declares is provided.
      .filter((peer) => !(peer in declares))
      .filter((peer) => !settled(key, peer))
      .map((peer) => `${project} (${peer}, for ${base(key)})`),
  );
}

/**
 * pnpm resolves an optional peer that no package above it depends on to a copy it finds elsewhere
 * in the graph. With more than one version there, which one depends on the order it walks the
 * graph in: adding a dependency to any project can swap it, and every package above it changes
 * variant in the lockfile with it. `debug`'s `supports-color` (7 and 8) did this to Babel and Expo,
 * and Vite's `jiti` (1 from Tailwind 3, 2 from Tailwind 4) to Vitest. A project that declares the
 * peer itself gets that version, as one does that depends on the package with the peer directly.
 */
it('declares an optional peer that its dependencies hold more than one version of', () => {
  const lockfile = graph();
  const missing = [...importers()].flatMap(([project, dependencies]) =>
    unsettledPeers(project, dependencies, lockfile),
  );
  assert.deepEqual(
    [...new Set(missing)],
    [],
    'these projects leave an optional peer for pnpm to pick',
  );
});

describe('an optional peer pnpm has to pick', () => {
  /**
   * `app` depends on `q` 2 and on `wrapper`, which depends on `uses`, which takes `q` as an
   * optional peer. `old` brings `q` 1, and `loose` depends on `uses` with nothing that provides `q`.
   */
  const lockfile: Graph = {
    optionalPeers: new Map([['uses@1.0.0', new Set(['q'])]]),
    children: new Map([
      ['app@1.0.0', ['q@2.0.0', 'wrapper@1.0.0', 'old@1.0.0']],
      ['wrapper@1.0.0', ['uses@1.0.0(q@2.0.0)']],
      ['old@1.0.0', ['q@1.0.0']],
      ['loose@1.0.0', ['uses@1.0.0(q@2.0.0)']],
    ]),
  };

  it('is settled by a package further up than its parent', () => {
    const found = unsettledPeers('p', new Map([['app', '1.0.0']]), lockfile, {});
    assert.deepEqual(found, []);
  });

  it('is unsettled when one path to it has nothing that provides it', () => {
    const dependencies = new Map([
      ['app', '1.0.0'],
      ['loose', '1.0.0'],
    ]);
    const found = unsettledPeers('p', dependencies, lockfile, {});
    assert.deepEqual(found, ['p (q, for uses@1.0.0)']);
  });
});
