/** The Linux launcher: where a container finds a relative bundle, and that `stop` ends the whole host. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { linuxLaunchCommand, linuxLauncher } from './linux-launcher.ts';

const request = { port: 1234, runId: 'abc', stateDir: '/unused' };

describe('linuxLaunchCommand in a container', () => {
  it('resolves a relative bundle against cwd, for the mount and for the host', () => {
    const launch = linuxLaunchCommand(
      {
        host: '/home/u/build/gtk/ngn-linux',
        container: 'img',
        cwd: '/work/app',
        bundle: 'out/app.bundle',
        display: 'xvfb',
      },
      request,
      {},
    );
    assert.ok(launch.args.includes('/work/app/out:/work/app/out:ro'));
    assert.ok(launch.args.includes('/work/app/out/app.bundle'));
  });

  it('leaves an HTTP bundle alone and mounts nothing for it', () => {
    const launch = linuxLaunchCommand(
      {
        host: '/home/u/build/gtk/ngn-linux',
        container: 'img',
        cwd: '/work/app',
        bundle: 'http://127.0.0.1:1/x',
        display: 'xvfb',
      },
      request,
      {},
    );
    assert.ok(launch.args.includes('http://127.0.0.1:1/x'));
    assert.equal(launch.args.filter((arg) => arg.endsWith(':ro')).length, 1);
  });
});

/** Whether process `pid` is gone within two seconds. */
async function gone(pid: number): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

describe('linuxLauncher stop', () => {
  it('kills a host that ignores SIGTERM, and what it started, before removing the state', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ngn-linux-launcher-'));
    const stateDir = path.join(dir, 'state');
    mkdirSync(stateDir);
    const pidFile = path.join(dir, 'child.pid');
    const host = path.join(dir, 'host.sh');
    writeFileSync(
      host,
      `#!/bin/bash\ntrap '' TERM\nsleep 60 &\necho "$$ $!" > ${pidFile}\nwhile true; do sleep 1; done\n`,
      { mode: 0o755 },
    );
    const launcher = linuxLauncher({
      host,
      container: false,
      display: 'inherit',
      stopGraceMs: 300,
    });
    const app = await launcher.start({ port: 1, runId: 'stop-test', stateDir });
    let pids: number[] = [];
    try {
      for (let i = 0; i < 100 && !existsSync(pidFile); i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      pids = readFileSync(pidFile, 'utf8').trim().split(' ').map(Number);
      assert.equal(pids.length, 2);
      await app.stop();
      // Orphaned by the session's end, each is reaped by init a moment after it dies.
      for (const pid of pids) assert.equal(await gone(pid), true, `process ${pid} outlived stop`);
      assert.equal(existsSync(stateDir), false);
    } finally {
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Vitest as PID 1 of a container without `--init` adopts what the session leaves behind (Weston's
  // helper clients, a host's own children) and never reaps it. A subreaper that never reaps stands
  // in for that PID 1 here: Python marks itself one and becomes Node, which only reaps its own.
  it(
    'returns when only zombies the runner never reaps are left in the group',
    { skip: process.platform !== 'linux' },
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'ngn-linux-launcher-'));
      try {
        const host = path.join(dir, 'host.sh');
        // The subshell exits at once, so its `sleep` is orphaned to the subreaper.
        writeFileSync(host, '#!/bin/bash\n(sleep 60 &)\nexec sleep 60\n', { mode: 0o755 });
        mkdirSync(path.join(dir, 'state'));
        const scenario = `
          const { linuxLauncher } = await import(${JSON.stringify(new URL('./linux-launcher.ts', import.meta.url).href)});
          const launcher = linuxLauncher({ host: ${JSON.stringify(host)}, container: false, display: 'inherit', stopGraceMs: 300 });
          const app = await launcher.start({ port: 1, runId: 'reaper', stateDir: ${JSON.stringify(path.join(dir, 'state'))} });
          await new Promise((resolve) => setTimeout(resolve, 500));
          const stopped = app.stop().then(() => 'stopped');
          const hung = new Promise((resolve) => setTimeout(() => resolve('hung'), 5000));
          console.log(await Promise.race([stopped, hung]));
          process.exit(0);
        `;
        const subreaper = [
          'import ctypes, os, sys',
          'assert ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0',
          'os.execv(sys.argv[1], sys.argv[1:])',
        ].join('\n');
        const result = spawnSync(
          'python3',
          ['-c', subreaper, process.execPath, '--input-type=module', '-e', scenario],
          { encoding: 'utf8', timeout: 20_000 },
        );
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), 'stopped');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
