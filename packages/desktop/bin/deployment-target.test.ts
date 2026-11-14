import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MINIMUM_MACOS } from './package.mjs';

const scripts = fileURLToPath(new URL('../native/scripts/', import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), 'ngn-deployment-target-'));
after(() => rmSync(root, { recursive: true, force: true }));

const script = (name: string, args: string[] = []) =>
  spawnSync('bash', [path.join(scripts, name), ...args], { encoding: 'utf8' });

describe('the deployment target', () => {
  it('is macOS 14, the packaged app’s minimum, for the host and for Hermes', () => {
    const target = script('macos-target.sh');
    assert.equal(target.status, 0, target.stderr);
    assert.equal(target.stdout.trim(), MINIMUM_MACOS);
    assert.equal(MINIMUM_MACOS, '14.0');
    // Hermes is built for the same, never a number of its own.
    const hermes = readFileSync(path.join(scripts, 'build-hermes.sh'), 'utf8');
    assert.match(hermes, /-DCMAKE_OSX_DEPLOYMENT_TARGET="\$TARGET"/);
    assert.doesNotMatch(hermes, /DEPLOYMENT_TARGET=\d/);
  });

  it('builds Hermes again when the cached one is missing, unfinished or for another macOS', () => {
    const built = (stamp: string | null, library = true) => {
      const dir = mkdtempSync(path.join(root, 'hermes-'));
      if (library) {
        mkdirSync(path.join(dir, 'lib'));
        writeFileSync(path.join(dir, 'lib', 'libhermesvm_a.a'), '');
      }
      if (stamp !== null) writeFileSync(path.join(dir, 'macos-target'), `${stamp}\n`);
      return script('hermes-built.sh', [dir]).status === 0;
    };
    assert.ok(built(MINIMUM_MACOS));
    // A Hermes from before the target was recorded, or for macOS 13.
    assert.ok(!built(null));
    assert.ok(!built('13.0'));
    // A build that stopped before its library.
    assert.ok(!built(MINIMUM_MACOS, false));
    assert.ok(!built(null, false));
  });

  it('is what build.sh checks before reusing a Hermes', () => {
    const build = readFileSync(path.join(scripts, 'build.sh'), 'utf8');
    assert.match(
      build,
      /if ! "\$here\/hermes-built\.sh" "\$hermes"; then\n\s+"\$here\/build-hermes\.sh"/,
    );
  });
});
