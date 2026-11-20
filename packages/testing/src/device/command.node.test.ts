/** The pool's tool commands: their output on a failure, and stopping one as the run ends. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { runCommand } from './command.ts';

describe('a command the pool runs', () => {
  it('fails with its last output, or gives it back when a failure is allowed', async () => {
    const script = "console.log('first'); console.error('what went wrong'); process.exit(3)";
    await assert.rejects(
      runCommand(process.execPath, ['-e', script]),
      /failed \(status 3\):\nfirst\nwhat went wrong/,
    );
    const { status, output } = await runCommand(process.execPath, ['-e', script], {
      allowFailure: true,
    });
    assert.equal(status, 3);
    assert.match(output, /what went wrong/);
  });

  it('is stopped when the run ends, at once', async () => {
    const stop = new AbortController();
    const started = Date.now();
    const running = runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      signal: stop.signal,
    });
    setTimeout(() => stop.abort(), 100);
    await assert.rejects(running, /was stopped: the run ended/);
    assert.ok(Date.now() - started < 5000, 'not after the command would have ended');
  });

  it('rejects a stop only once the command has exited', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ng-native-command-'));
    try {
      const done = path.join(dir, 'done');
      // Outlives the stop by a moment, as a tool finishing a write does.
      const script =
        "process.on('SIGTERM', () => setTimeout(() => " +
        `{ require('fs').writeFileSync(${JSON.stringify(done)}, ''); process.exit(1); }, 200)); ` +
        "setTimeout(() => {}, 30000); console.log('ready')";
      const stop = new AbortController();
      const running = runCommand(process.execPath, ['-e', script], { signal: stop.signal });
      setTimeout(() => stop.abort(), 300);
      await assert.rejects(running, /was stopped: the run ended/);
      assert.equal(existsSync(done), true, 'the command had exited');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
