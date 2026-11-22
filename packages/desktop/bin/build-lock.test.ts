import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('../native/scripts/', import.meta.url));
const now = `perl -MTime::HiRes=time -e 'printf "%.3f\\n", time'`;

interface Locked {
  child: ChildProcess;
  /** What it has printed on stderr so far. */
  stderr(): string;
  /** Settles with its stdout once it has closed. */
  done: Promise<string>;
}

/** A bash, in a process group of its own, that takes the build lock on `dir` and runs `body`. */
function locked(dir: string, body: string): Locked {
  const script = `set -euo pipefail\n. "${path.join(scripts, 'build-lock.sh')}"\nlock_build "${dir}"\n${body}`;
  const child = spawn('bash', ['-c', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', (chunk) => (stdout += chunk));
  child.stderr!.on('data', (chunk) => (stderr += chunk));
  const done = new Promise<string>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`bash: ${stderr}`)),
    );
  });
  done.catch(() => {});
  return { child, stderr: () => stderr, done };
}

/** Stop each one's whole group, SIGKILL after a bounded wait, and wait for it to close. */
async function stop(...running: Locked[]): Promise<void> {
  for (const { child, done } of running) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const group = (signal: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, signal);
      } catch {
        // Already gone.
      }
    };
    group('SIGTERM');
    await Promise.race([done.catch(() => {}), delay(2000)]);
    group('SIGKILL');
    await done.catch(() => {});
  }
}

async function until(condition: () => boolean, what: string) {
  for (let i = 0; i < 400 && !condition(); i++) await delay(25);
  assert.ok(condition(), `${what} never happened`);
}

describe('the build lock', () => {
  it('makes a second build in the same directory wait for the first', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ngn-build-lock-'));
    const running: Locked[] = [];
    try {
      const dir = path.join(tmp, 'build');
      const [held, release] = [path.join(tmp, 'held'), path.join(tmp, 'release')];
      // Held until the test lets go, so the second always meets it held.
      const first = locked(
        dir,
        `touch "${held}"\nwhile [ ! -e "${release}" ]; do sleep 0.05; done\n${now}`,
      );
      running.push(first);
      await until(() => existsSync(held), 'the first build taking the lock');
      const second = locked(dir, now);
      running.push(second);
      await until(() => /waiting for another build in .*build/.test(second.stderr()), 'the wait');
      writeFileSync(release, '');
      const [a, b] = await Promise.all([first.done, second.done]);
      assert.ok(Number(b) >= Number(a), 'the second build ran beside the first');
      assert.equal(first.stderr(), '');
    } finally {
      await stop(...running);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('stays held by what the build started after its script ends', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ngn-build-lock-'));
    const running: Locked[] = [];
    try {
      const dir = path.join(tmp, 'build');
      const done = path.join(tmp, 'done');
      // A ninja left running after build.sh was killed: a child holding the descriptor.
      const first = locked(dir, `(sleep 1; ${now} > "${done}") > /dev/null 2>&1 &`);
      running.push(first);
      await first.done;
      const second = locked(dir, now);
      running.push(second);
      const after = await second.done;
      await until(() => existsSync(done), 'the child finishing');
      assert.ok(Number(after) >= Number(readFileSync(done, 'utf8')));
    } finally {
      await stop(...running);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('is taken by build.sh before it configures, and held by the ninja it runs itself', () => {
    const build = readFileSync(path.join(scripts, 'build.sh'), 'utf8');
    const lock = build.indexOf('lock_build "$BUILD"');
    assert.ok(lock > build.indexOf('BUILD="${build_dir:-'), 'locked before BUILD is set');
    assert.ok(
      lock < build.indexOf('cmake --log-level=WARNING -G Ninja'),
      'locked after configuring',
    );
    assert.match(build, /^\. "\$here\/build-lock\.sh"$/m);
    // CMake starts its build tool with none of the shell's descriptors, so not through it.
    assert.doesNotMatch(build, /^[^#\n]*cmake --build/m);
    assert.match(build, /"\$\{ninja:-ninja\}" -C "\$BUILD"/);
  });
});
