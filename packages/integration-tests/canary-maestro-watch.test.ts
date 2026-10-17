/**
 * `examples/canary/scripts/maestro-watch.sh`: the iOS smoke walk runs Maestro through it, so a
 * Maestro that throws on its main thread and keeps running fails the walk at once, rather than
 * the CI job waiting out its timeout. A fake command stands in for Maestro.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(
  new URL('../../examples/canary/scripts/maestro-watch.sh', import.meta.url),
);

/** A child that writes to `$MARKER` until it is ended, as Maestro's JVM runs on. */
const LOOP = '(while true; do date >> "$MARKER"; sleep 0.2; done) &\nwait';

/**
 * A fake `maestro` running `body` in a directory of its own, and what `run` makes of it. The fake
 * writes its process id first: the watch puts it in a group of its own, which `finally` ends, and
 * whatever runs from its directory, so a test that fails never leaves its loop running.
 */
async function withFake<T>(
  body: string,
  run: (command: string, log: string) => Promise<T>,
): Promise<T & { log: string; outlived: boolean }> {
  const directory = mkdtempSync(path.join(tmpdir(), 'maestro-watch-'));
  const marker = path.join(directory, 'still-running');
  const pidFile = path.join(directory, 'pid');
  try {
    const command = path.join(directory, 'maestro');
    const script = `#!/usr/bin/env bash\necho $$ > "${pidFile}"\n${body.replaceAll('$MARKER', marker)}\n`;
    writeFileSync(command, script);
    chmodSync(command, 0o755);
    const log = path.join(directory, 'console.log');
    const result = await run(command, log);
    // A command the watch ended must not outlive it: its child would still be writing.
    const before = read(marker);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return { ...result, log: read(log), outlived: read(marker) !== before };
  } finally {
    const pid = Number(read(pidFile));
    if (pid) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Already ended, as it should be.
      }
    }
    // And anything of its own left outside that group, should the watch not have made one.
    spawnSync('pkill', ['-KILL', '-f', directory]);
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Runs `body` under the watch with `seconds` to run. */
function watch(body: string, seconds = 30) {
  return withFake(body, async (command, log) => {
    const started = Date.now();
    const run = spawnSync('bash', [script, log, String(seconds), '--', command], {
      encoding: 'utf8',
      timeout: 20_000,
      // Not SIGTERM, which the watch takes as its cue to end the command and could wait on.
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024 * 1024,
    });
    return { status: run.status, seconds: (Date.now() - started) / 1000 };
  });
}

function read(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

const THREW =
  'echo \'Exception in thread "main" UnknownFailure(errorResponse=Request for terminateApp failed, code: 500, body: )\'';

describe("the canary's Maestro watch", () => {
  it('passes a command that finishes through, with its exit code and its output logged', async () => {
    const passed = await watch('echo "Flow Passed"');
    assert.equal(passed.status, 0);
    assert.match(passed.log, /Flow Passed/);
    assert.equal((await watch('echo "Flow Failed"; exit 3')).status, 3);
  });

  it('ends Maestro at once when it throws on its main thread and keeps running', async () => {
    // The CI log's line, then a child that never ends, as Maestro's JVM did.
    const result = await watch(`${THREW}\n${LOOP}`);
    assert.equal(result.status, 70);
    assert.ok(result.seconds < 15, `ended in ${result.seconds}s, not at the limit`);
    assert.match(result.log, /terminateApp failed, code: 500/);
    assert.equal(result.outlived, false, 'the hung process is ended with it');
  });

  it('finds the exception however much is printed after it', async () => {
    // Enough after the line that a reader of the log stops before its end.
    const result = await watch(`${THREW}\nhead -c 2000000 /dev/zero | tr '\\0' 'x'; echo\n${LOOP}`);
    assert.equal(result.status, 70);
    assert.ok(result.seconds < 15, `ended in ${result.seconds}s, not at the limit`);
  });

  it('ends a command that runs past its time, whatever it prints', async () => {
    const result = await watch(LOOP, 2);
    assert.equal(result.status, 124);
    assert.ok(result.seconds < 15, `ended in ${result.seconds}s`);
    assert.equal(result.outlived, false);
  });

  it('ends the command with it when the watch is ended, as a cancelled job ends it', async () => {
    const result = await withFake(LOOP, async (command, log) => {
      const running = spawn('bash', [script, log, '30', '--', command], { stdio: 'ignore' });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      running.kill('SIGTERM');
      // A watch that does not end on the signal is ended here, and fails the test.
      const ended = await new Promise<boolean>((resolve) => {
        const late = setTimeout(() => (running.kill('SIGKILL'), resolve(false)), 10_000);
        running.on('exit', () => (clearTimeout(late), resolve(true)));
      });
      return { ended };
    });
    assert.equal(result.ended, true, 'the watch ends on the signal');
    assert.equal(result.outlived, false, 'the command is ended with the watch');
  });
});
