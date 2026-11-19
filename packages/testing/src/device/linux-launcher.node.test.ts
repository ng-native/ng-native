/**
 * The Linux launcher: where a container finds a relative bundle and which ports it forwards, that
 * `stop` ends the whole host, and that a crash report holds the host's last output.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

  it("forwards a loopback bundle URL's port beside the pool's and Metro's, each once", () => {
    const script = (bundle: string) => {
      const { args } = linuxLaunchCommand(
        { host: '/home/u/build/gtk/ngn-linux', container: 'img', bundle, display: 'xvfb' },
        request,
        {},
      );
      return args[args.indexOf('-c') + 1];
    };
    assert.match(script('http://127.0.0.1:9090/main.bundle'), / 1234 8081 9090 &\n/);
    assert.match(script('http://localhost:8081/main.bundle'), / 1234 8081 &\n/);
    assert.match(script('http://192.168.1.2:9090/main.bundle'), / 1234 8081 &\n/);
  });
});

describe('linuxLauncher crashReport', () => {
  it('holds the output the host wrote after the session exited', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ngn-linux-launcher-'));
    const stateDir = path.join(dir, 'state');
    mkdirSync(stateDir);
    const host = path.join(dir, 'host.sh');
    // The last line reaches the pipe after the exit, as a crash message still in flight would.
    writeFileSync(host, '#!/bin/bash\n(sleep 0.3; echo the last line) &\nexit 3\n', {
      mode: 0o755,
    });
    const launcher = linuxLauncher({ host, container: false, display: 'inherit' });
    const app = await launcher.start({ port: 1, runId: 'crash-test', stateDir });
    try {
      assert.equal(await app.exited, 'status 3');
      assert.match((await launcher.crashReport?.(0)) ?? '', /the last line/);
    } finally {
      try {
        await app.stop();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('holds an unfinished last line while a process the host left keeps the pipes open', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ngn-linux-launcher-'));
    const stateDir = path.join(dir, 'state');
    mkdirSync(stateDir);
    const host = path.join(dir, 'host.sh');
    // No line break after the message, and a child holding the pipes past the drain's wait.
    writeFileSync(host, "#!/bin/bash\nprintf 'fatal detail' >&2\nsleep 30 &\nexit 3\n", {
      mode: 0o755,
    });
    const launcher = linuxLauncher({ host, container: false, display: 'inherit' });
    const app = await launcher.start({ port: 1, runId: 'crash-test', stateDir });
    try {
      assert.equal(await app.exited, 'status 3');
      assert.match((await launcher.crashReport?.(0)) ?? '', /fatal detail/);
    } finally {
      try {
        await app.stop();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});

/** A file's text, or an empty string while it is missing or empty. */
function readFileIfAny(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

/**
 * Whether process `pid` (a group, when negative) is gone within two seconds. On Linux a zombie
 * counts as gone: as PID 1 without an init, the runner never reaps what the host leaves, and
 * `kill(pid, 0)` still finds it.
 */
async function gone(pid: number): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    if (!running(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

/** Whether `pid` (a group, when negative) has a member that is not a zombie. */
function running(pid: number): boolean {
  if (process.platform !== 'linux') {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  return readdirSync('/proc').some((name) => {
    if (!/^\d+$/.test(name)) return false;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      // `pid (comm) state ppid pgrp ...`, where comm may hold spaces and parentheses.
      const [state, , pgrp] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return state !== 'Z' && (pid > 0 ? Number(name) === pid : Number(pgrp) === -pid);
    } catch {
      return false; // Gone since the listing.
    }
  });
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
      // Orphaned by the session's end, each is reaped by init a moment after it dies, or lingers as a zombie.
      for (const pid of pids) assert.equal(await gone(pid), true, `process ${pid} outlived stop`);
      assert.equal(existsSync(stateDir), false);
    } finally {
      try {
        // A setup that failed after the start leaves the host running: stopping again is harmless.
        await app.stop();
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
    }
  });

  // A scan of /proc misses a process forked after its listing whose parent exits before the scan
  // reads it. This host is only ever that: each process forks the next and exits at once. Idle
  // processes started first lengthen the scan before it reaches the host's, so a scan all but
  // always misses it, and the host is launched and stopped several times.
  it('kills a host that keeps forking a successor and exiting', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ngn-linux-launcher-'));
    const ready = path.join(dir, 'padding');
    const padding = spawn(
      'bash',
      ['-c', `for _ in $(seq 300); do sleep 60 & done; touch ${ready}; wait`],
      { detached: true, stdio: 'ignore' },
    );
    try {
      for (let i = 0; i < 200 && !existsSync(ready); i++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const groupFile = path.join(dir, 'group');
      const host = path.join(dir, 'host.sh');
      writeFileSync(
        host,
        `#!/bin/bash\ntrap '' TERM\nps -o pgid= -p $$ > ${groupFile}\nhop() { hop & exit 0; }\nhop\n`,
        { mode: 0o755 },
      );
      const launcher = linuxLauncher({
        host,
        container: false,
        display: 'inherit',
        stopGraceMs: 300,
      });
      for (let launch = 0; launch < 5; launch++) {
        rmSync(groupFile, { force: true });
        const stateDir = path.join(dir, `state-${launch}`);
        mkdirSync(stateDir);
        const app = await launcher.start({ port: 1, runId: `hop-test-${launch}`, stateDir });
        let group = 0;
        try {
          for (let i = 0; i < 100 && !readFileIfAny(groupFile); i++) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          group = Number(readFileSync(groupFile, 'utf8'));
          assert.ok(group > 0);
          await app.stop();
          assert.equal(await gone(-group), true, `the host outlived stop on launch ${launch}`);
        } finally {
          try {
            await app.stop();
          } finally {
            if (group) {
              try {
                process.kill(-group, 'SIGKILL');
              } catch {
                // Already gone.
              }
            }
          }
        }
      }
    } finally {
      try {
        if (padding.pid) process.kill(-padding.pid, 'SIGKILL');
      } catch {
        // Already gone.
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
