/**
 * native/scripts/launch-probe.sh, the CI check that the built host launches, against stand-in hosts:
 * shell scripts that print what the host logs, and then exit or keep running.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const probe = fileURLToPath(new URL('../native/scripts/launch-probe.sh', import.meta.url));

/** Runs the probe on a host whose body is `script` (it gets the bundle path as $1). */
function launch(script: string, seconds = 10) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ngn-launch-probe-'));
  try {
    const host = path.join(dir, 'ngn-macos');
    writeFileSync(host, `#!/usr/bin/env bash\n${script}\n`);
    chmodSync(host, 0o755);
    const bundle = path.join(dir, 'main.js');
    writeFileSync(bundle, '');
    const result = spawnSync('bash', [probe, host, bundle, String(seconds)], { encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const started = `echo '[ngn] commit 0.4 ms' >&2; echo '[ngn] first frame 640 ms after launch' >&2`;

describe('launch-probe.sh', () => {
  it('passes a host that commits, draws its first frame and keeps running', () => {
    const result = launch(`${started}; exec sleep 30`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /first frame 640 ms after launch, 1 commits/);
  });

  it('runs the host as a test launch, with a state directory of its own', () => {
    const result = launch(
      `[ "$NGN_TESTS" = 1 ] && [ -d "$NGN_STATE_DIR" ] && [ -n "$NGN_RUN_ID" ] && [ "$NGN_LOG_COMMITS" = 1 ] || exit 3; [ -f "$1" ] || exit 4; ${started}; exec sleep 30`,
    );
    assert.equal(result.status, 0, result.stderr);
  });

  it('fails a host that exits before its first frame, with its status and log', () => {
    const result = launch(`echo 'dyld: missing symbol' >&2; exit 6`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /the host exited \(6\) before its first frame/);
    assert.match(result.stderr, /dyld: missing symbol/);
  });

  it('fails a host that exits after its first frame', () => {
    const result = launch(`${started}; sleep 1; exit 0`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /the host exited \(0\) after its first frame/);
  });

  it('fails a host that never draws', () => {
    const result = launch(`exec sleep 30`, 2);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no first frame within 2s/);
  });

  it('fails a first frame that came with no commit', () => {
    const result = launch(`echo '[ngn] first frame 300 ms after launch' >&2; exec sleep 30`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /the first frame came with no commit/);
  });

  it('fails an uncaught JavaScript error or a console.error, before or after the first frame', () => {
    const uncaught = `echo 'E1117 DefaultOnJsErrorHandler.h:18] [onJsError called]: ProcessedError {' >&2`;
    assert.match(
      launch(`${uncaught}; exec sleep 30`).stderr,
      /a JavaScript error before the first frame/,
    );
    const consoleError = `echo 'I1117 runtime.cpp:154] [js:3] Something failed' >&2`;
    assert.match(
      launch(`${started}; sleep 1; ${consoleError}; exec sleep 30`).stderr,
      /a JavaScript error after the first frame/,
    );
  });
});
