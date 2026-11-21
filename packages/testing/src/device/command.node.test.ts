/** The pool's tool commands: their output on a failure, and stopping one as the run ends. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { keepLines, runCommand, runningInGroup } from './command.ts';

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

  it('answers a stop only once all it started has gone, output redirected or not', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ng-native-command-'));
    try {
      const late = path.join(dir, 'late');
      // A member that ignores SIGTERM and lets go of the output, so the shell's exit closes it.
      const writer = `trap '' TERM; sleep 1; touch ${JSON.stringify(late)}`;
      const running = runCommand(
        'sh',
        ['-c', `sh -c ${JSON.stringify(writer)} >/dev/null 2>&1 </dev/null & sleep 30`],
        { signal: AbortSignal.timeout(200) },
      );
      await assert.rejects(running, /was stopped: the run ended/);
      assert.equal(existsSync(late), true, 'the writer had finished when the stop was answered');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('counts a group of zombies as stopped, and any other member as running', () => {
    const stat = (pid: number, comm: string, state: string, pgrp: number) =>
      `${pid} (${comm}) ${state} 1 ${pgrp} ${pgrp} 0 -1 4194560`;
    const zombies = [stat(10, 'gradle (daemon)', 'Z', 10), stat(11, 'java', 'Z', 10)];
    assert.equal(runningInGroup(zombies, 10), false, 'only zombies, as where nothing reaps');
    assert.equal(runningInGroup([...zombies, stat(12, 'a) S 1 10', 'S', 10)], 10), true);
    assert.equal(runningInGroup([...zombies, stat(13, 'node', 'R', 99)], 10), false);
    assert.equal(runningInGroup([stat(14, 'sh', 'D', 10)], 10), true, 'in the kernel, not gone');
  });

  it('keeps the last lines of output that arrives in chunks, line breaks and all', () => {
    let kept = '';
    for (const chunk of ['Loading\n', 'Waiting\n', 'for Metro', ' still\n']) {
      kept = keepLines(kept + chunk, 2);
    }
    assert.equal(kept, 'Waiting\nfor Metro still\n');
  });
});
