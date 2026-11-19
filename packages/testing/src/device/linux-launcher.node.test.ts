/** The Linux launcher: where a container finds a relative bundle, and that `stop` ends the whole host. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { CRASH_MARKER, linuxLaunchCommand, linuxLauncher } from './linux-launcher.ts';

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

describe('linuxLauncher stop', () => {
  it('kills a host that ignores SIGTERM, and what it started, before removing the state', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ngn-linux-launcher-'));
    const stateDir = path.join(dir, 'state');
    mkdirSync(stateDir);
    const pidFile = path.join(dir, 'child.pid');
    const host = path.join(dir, 'host.sh');
    writeFileSync(
      host,
      `#!/bin/bash\ntrap '' TERM\nsleep 60 &\necho $! > ${pidFile}\nwhile true; do sleep 1; done\n`,
      { mode: 0o755 },
    );
    const launcher = linuxLauncher({
      host,
      container: false,
      display: 'inherit',
      stopGraceMs: 300,
    });
    const app = await launcher.start({ port: 1, runId: 'stop-test', stateDir });
    let child = 0;
    try {
      for (let i = 0; i < 100 && !existsSync(pidFile); i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      child = Number(readFileSync(pidFile, 'utf8'));
      assert.ok(child > 0);
      await app.stop();
      assert.throws(() => process.kill(child, 0), { code: 'ESRCH' });
      assert.equal(existsSync(stateDir), false);
    } finally {
      if (child) {
        try {
          process.kill(child, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('linuxLauncher crashReport', () => {
  it('recognises the crash marker when two chunks split it, and keeps a last unfinished line', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ngn-linux-launcher-'));
    try {
      const host = path.join(dir, 'host.sh');
      const half = CRASH_MARKER.length - 8;
      writeFileSync(
        host,
        [
          '#!/bin/bash',
          'echo before >&2',
          `printf '%s' '${CRASH_MARKER.slice(0, half)}' >&2`,
          'sleep 0.3',
          `printf '%s\n' '${CRASH_MARKER.slice(half)}' >&2`,
          'echo frame-1 >&2',
          "printf 'last-without-newline' >&2",
          '',
        ].join('\n'),
        { mode: 0o755 },
      );
      const launcher = linuxLauncher({ host, container: false, display: 'inherit' });
      const app = await launcher.start({ port: 1, runId: 'crash-test', stateDir: dir });
      try {
        await app.exited;
        let report = '';
        for (let i = 0; i < 100 && !report.includes('last-without-newline'); i++) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          report = String(await launcher.crashReport?.(0));
        }
        assert.equal(
          report,
          "The host's crash report:\nframe-1\nlast-without-newline\n\nThe host's last output:\nbefore",
        );
      } finally {
        await app.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
