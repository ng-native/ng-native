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
      const [ready, done] = [path.join(dir, 'ready'), path.join(dir, 'done')];
      // Outlives the stop by a moment, as a tool finishing a write does.
      const script =
        "const fs = require('fs'); process.on('SIGTERM', () => setTimeout(() => " +
        `{ fs.writeFileSync(${JSON.stringify(done)}, ''); process.exit(1); }, 200)); ` +
        `fs.writeFileSync(${JSON.stringify(ready)}, ''); setTimeout(() => {}, 30000);`;
      const stop = new AbortController();
      const running = runCommand(process.execPath, ['-e', script], { signal: stop.signal });
      for (let waited = 0; waited < 10_000 && !existsSync(ready); waited += 10) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(existsSync(ready), true, 'the command is handling SIGTERM');
      stop.abort();
      await assert.rejects(running, /was stopped: the run ended/);
      assert.equal(existsSync(done), true, 'the command had exited');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stops what the command started too, so nothing it left writes after the stop', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ng-native-command-'));
    try {
      const late = path.join(dir, 'late');
      // A shell that leaves a writer behind, as a build tool leaves its daemon or compiler.
      const running = runCommand(
        'sh',
        ['-c', `(sleep 1; touch ${JSON.stringify(late)}) & sleep 30`],
        { signal: AbortSignal.timeout(200) },
      );
      await assert.rejects(running, /was stopped: the run ended/);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.equal(existsSync(late), false, 'the process the command started was stopped');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('kills a command that ignores the stop, after a grace period', async () => {
    const started = Date.now();
    // An ignored SIGTERM is inherited, so sleep ignores it as well.
    const running = runCommand('sh', ['-c', "trap '' TERM; sleep 30"], {
      signal: AbortSignal.timeout(100),
    });
    await assert.rejects(running, /was stopped: the run ended/);
    const took = Date.now() - started;
    assert.ok(took > 4000 && took < 15000, `killed after ${took}ms, not at once or after 30s`);
  });
});
