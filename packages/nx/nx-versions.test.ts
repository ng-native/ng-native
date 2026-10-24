/**
 * The Nx versions `@ng-native/nx` installs beside. npm refuses a peer range the workspace's `nx`
 * is outside of, so `nx add @ng-native/nx` fails before any generator runs in a workspace on an
 * Nx the range leaves out. `create-nx-workspace@latest` installs Nx 24.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import semver from 'semver';

const manifest = JSON.parse(readFileSync(path.join(import.meta.dirname, 'package.json'), 'utf8'));

for (const version of ['23.0.0', '23.3.0', '24.0.0']) {
  it(`installs beside Nx ${version}`, () => {
    assert.ok(
      semver.satisfies(version, manifest.peerDependencies.nx),
      manifest.peerDependencies.nx,
    );
    assert.ok(
      semver.satisfies(version, manifest.dependencies['@nx/devkit']),
      manifest.dependencies['@nx/devkit'],
    );
  });
}
