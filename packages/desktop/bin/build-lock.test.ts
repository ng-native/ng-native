import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('../native/scripts/', import.meta.url));
const now = `perl -MTime::HiRes=time -e 'printf "%.3f\\n", time'`;

/** Runs `body` in a bash that has taken the build lock on `dir`; resolves with its output. */
function locked(dir: string, body: string): Promise<{ stdout: string; stderr: string }> {
  const script = `set -euo pipefail\n. "${path.join(scripts, 'build-lock.sh')}"\nlock_build "${dir}"\n${body}`;
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`bash exited ${code}: ${stderr}`));
    });
  });
}

async function until(file: string) {
  for (let i = 0; i < 200 && !existsSync(file); i++) await delay(25);
  assert.ok(existsSync(file), `${file} never appeared`);
}

describe('the build lock', () => {
  it('makes a second build in the same directory wait for the first', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ngn-build-lock-'));
    try {
      const dir = path.join(tmp, 'build');
      const held = path.join(tmp, 'held');
      const first = locked(dir, `touch "${held}"\nsleep 1\n${now}`);
      await until(held);
      const second = locked(dir, now);
      const [a, b] = await Promise.all([first, second]);
      assert.ok(Number(b.stdout) >= Number(a.stdout), 'the second build ran beside the first');
      assert.match(b.stderr, /waiting for another build in .*build/);
      assert.equal(a.stderr, '');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('stays held by what the build started after its script ends', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ngn-build-lock-'));
    try {
      const dir = path.join(tmp, 'build');
      const done = path.join(tmp, 'done');
      // A ninja left running after build.sh was killed: a child holding the descriptor.
      await locked(dir, `(sleep 1; ${now} > "${done}") > /dev/null 2>&1 &`);
      const second = await locked(dir, now);
      await until(done);
      assert.ok(Number(second.stdout) >= Number(readFileSync(done, 'utf8')));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('is taken by build.sh before it configures the build directory', () => {
    const build = readFileSync(path.join(scripts, 'build.sh'), 'utf8');
    const lock = build.indexOf('lock_build "$BUILD"');
    assert.ok(lock > build.indexOf('BUILD="${build_dir:-'), 'locked before BUILD is set');
    assert.ok(
      lock < build.indexOf('cmake --log-level=WARNING -G Ninja'),
      'locked after configuring',
    );
    assert.match(build, /^\. "\$here\/build-lock\.sh"$/m);
  });
});
