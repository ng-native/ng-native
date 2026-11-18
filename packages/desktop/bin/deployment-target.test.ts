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
    assert.match(hermes, /MACOS_TARGET="\$\("\$here\/macos-target\.sh"\)"/);
    assert.match(hermes, /-DCMAKE_OSX_DEPLOYMENT_TARGET="\$MACOS_TARGET"/);
    assert.doesNotMatch(hermes, /DEPLOYMENT_TARGET=\d/);
  });

  it('names the macOS Hermes is for, or off macOS the glibc and the ICU it links', () => {
    const target = script('hermes-target.sh');
    assert.equal(target.status, 0, target.stderr);
    const fetch = readFileSync(path.join(scripts, 'fetch.sh'), 'utf8');
    const pin = (name: string) => new RegExp(`^${name}=([0-9a-f]{64})$`, 'm').exec(fetch)![1]!;
    if (process.platform === 'darwin') {
      assert.equal(target.stdout.trim(), `macos ${MINIMUM_MACOS}`);
    } else {
      assert.match(
        target.stdout.trim(),
        new RegExp(
          `^linux glibc \\d+\\.\\d+ icu ${pin('ICU_SHA256')} ${pin('ICU_DATA_SHA256')} build [0-9a-f]{64}$`,
        ),
      );
    }
  });

  it('builds Hermes again when the cached one is missing, unfinished or for another target', () => {
    const current = script('hermes-target.sh').stdout.trim();
    const built = (stamp: string | null, library = true) => {
      const dir = mkdtempSync(path.join(root, 'hermes-'));
      if (library) {
        mkdirSync(path.join(dir, 'lib'));
        writeFileSync(path.join(dir, 'lib', 'libhermesvm_a.a'), '');
      }
      if (stamp !== null) writeFileSync(path.join(dir, 'target'), `${stamp}\n`);
      return script('hermes-built.sh', [dir]).status === 0;
    };
    assert.ok(built(current));
    // A Hermes from before the target was recorded, for macOS 13, or for anything else.
    assert.ok(!built(null));
    assert.ok(!built('macos 13.0'));
    assert.ok(!built(`${current} 1`));
    // A build that stopped before its library.
    assert.ok(!built(current, false));
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
