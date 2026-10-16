/**
 * `examples/canary/scripts/maestro-watch.sh`: the iOS smoke walk runs Maestro through it, so a
 * Maestro that throws on its main thread and keeps running fails the walk at once, rather than
 * the CI job waiting out its timeout. A fake command stands in for Maestro.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const script = new URL('../../examples/canary/scripts/maestro-watch.sh', import.meta.url).pathname;

/** Runs `body` as the command under the watch, with `seconds` to run, in a directory of its own. */
function watch(body: string, seconds = 30) {
  const directory = mkdtempSync(path.join(tmpdir(), 'maestro-watch-'));
  try {
    const command = path.join(directory, 'maestro');
    const marker = path.join(directory, 'still-running');
    writeFileSync(command, `#!/usr/bin/env bash\n${body.replaceAll('$MARKER', marker)}\n`);
    chmodSync(command, 0o755);
    const log = path.join(directory, 'console.log');
    const started = Date.now();
    const run = spawnSync('bash', [script, log, String(seconds), '--', command], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    // A command the watch ended must not outlive it: the marker's writer would still be writing.
    const before = readMarker(marker);
    spawnSync('sleep', ['1.5']);
    return {
      status: run.status,
      seconds: (Date.now() - started) / 1000,
      log: readFileSync(log, 'utf8'),
      outlived: readMarker(marker) !== before,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function readMarker(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

describe("the canary's Maestro watch", () => {
  it('passes a command that finishes through, with its exit code and its output logged', () => {
    const passed = watch('echo "Flow Passed"');
    assert.equal(passed.status, 0);
    assert.match(passed.log, /Flow Passed/);
    assert.equal(watch('echo "Flow Failed"; exit 3').status, 3);
  });

  it('ends Maestro at once when it throws on its main thread and keeps running', () => {
    // The CI log's line, then a child that never ends, as Maestro's JVM did.
    const result = watch(
      [
        'echo \'Exception in thread "main" UnknownFailure(errorResponse=Request for terminateApp failed, code: 500, body: )\'',
        '(while true; do date >> "$MARKER"; sleep 0.2; done) &',
        'wait',
      ].join('\n'),
    );
    assert.equal(result.status, 70);
    assert.ok(result.seconds < 15, `ended in ${result.seconds}s, not at the limit`);
    assert.match(result.log, /terminateApp failed, code: 500/);
    assert.equal(result.outlived, false, 'the hung process is ended with it');
  });

  it('ends a command that runs past its time, whatever it prints', () => {
    const result = watch('(while true; do date >> "$MARKER"; sleep 0.2; done) &\nwait', 2);
    assert.equal(result.status, 124);
    assert.ok(result.seconds < 15, `ended in ${result.seconds}s`);
    assert.equal(result.outlived, false);
  });
});
