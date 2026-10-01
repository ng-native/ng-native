/**
 * Every workspace project whose dependencies need Babel 7 or TypeScript 6 as a peer declares it.
 *
 * pnpm installs a peer a project does not declare itself, and it picks the newest version anywhere
 * in the workspace, whatever range the peer asks for. React Native's Babel packages peer on any
 * `@babel/core`, and `@angular/compiler-cli` brings `@babel/core` 8, so a project that does not
 * declare Babel 7 gets React Native on Babel 8 the next time anything re-resolves the lockfile:
 * adding a dependency to any package is enough. That puts React Native in the workspace twice, once
 * per Babel, with React Native's Babel 7 plugins on a Babel they do not support. Nx's TypeScript
 * peer drifts the same way, to TypeScript 7, which has no JavaScript API for Nx to read a tsconfig
 * with. A project that declares the peer keeps the version it declares.
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

/** A peer, the dependencies that need it, and the major version they need. */
const PEERS: { peer: string; of: (dependency: string) => boolean; major: number }[] = [
  { peer: '@babel/core', of: () => true, major: 7 },
  {
    peer: 'typescript',
    of: (dependency) => dependency === 'nx' || dependency.startsWith('@nx/'),
    major: 6,
  },
];

describe('the peers a workspace project needs', () => {
  for (const { peer, of, major } of PEERS) {
    it(`declares ${peer} ${major} wherever a dependency needs it as a peer`, () => {
      const missing: string[] = [];
      for (const [project, dependencies] of importers()) {
        const needs = [...dependencies].some(
          ([name, version]) => of(name) && version.includes(`(${peer}@`),
        );
        const range = declared(project)[peer];
        if (needs && !range?.match(new RegExp(`^[~^]?${major}\\.`))) missing.push(project);
      }
      assert.deepEqual(missing, [], `these projects leave ${peer} for pnpm to pick`);
    });
  }
});
