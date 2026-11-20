/** The pool's tool commands: their output on a failure, and stopping one as the run ends. */
import assert from 'node:assert/strict';
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
});
