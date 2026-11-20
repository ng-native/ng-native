/**
 * native/scripts/start-xvfb.sh, which CI's Linux steps start their display with, against stand-in
 * Xvfb commands on PATH: shell scripts that write the display's number to -displayfd, or exit.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../native/scripts/start-xvfb.sh', import.meta.url));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Runs the script with an Xvfb whose body is `body`, noting whether that Xvfb was still running
 * when the script returned, and stops it.
 */
function start(body: string, seconds = 5) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ngn-start-xvfb-'));
  let xvfb = 0;
  try {
    const stub = path.join(dir, 'Xvfb');
    writeFileSync(stub, `#!/usr/bin/env bash\necho "$$ $*" > "${dir}/args"\n${body}\n`);
    chmodSync(stub, 0o755);
    const began = Date.now();
    const result = spawnSync('bash', [script, path.join(dir, 'xvfb.log'), String(seconds)], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env['PATH']}` },
      timeout: 30_000,
    });
    const ms = Date.now() - began;
    const [pid = '0', ...args] = readFileSync(path.join(dir, 'args'), 'utf8').trim().split(' ');
    xvfb = Number(pid);
    return { ...result, ms, xvfb, args, running: alive(xvfb) };
  } finally {
    if (xvfb > 0 && alive(xvfb)) process.kill(xvfb);
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('start-xvfb.sh', () => {
  it('returns once Xvfb writes its display, printing the PID of the Xvfb it leaves running', () => {
    const result = start(`sleep 0.6; echo 99 >&3; exec sleep 30`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), String(result.xvfb));
    assert.ok(result.running, 'the caller stops it, with its trap');
    assert.ok(result.ms >= 600, `returned after ${result.ms} ms, before the display was written`);
    assert.equal(result.args[0], ':99');
    assert.ok(result.args.join(' ').includes('-displayfd 3'));
  });

  it('fails at once, with the log, when Xvfb exits before it takes connections', () => {
    const result = start(`echo 'server already running' >&2; exit 1`, 20);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Xvfb on :99 exited before it took connections/);
    assert.match(result.stderr, /server already running/);
    assert.ok(result.ms < 10_000, `took ${result.ms} ms`);
  });

  it('fails, with the log, and stops Xvfb when it never takes connections', () => {
    const result = start(`echo 'still starting' >&2; exec sleep 30`, 1);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Xvfb on :99 did not take connections within 1s/);
    assert.match(result.stderr, /still starting/);
    assert.ok(!result.running);
  });
});
