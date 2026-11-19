/**
 * The Linux mode of the screens-check skill (`.claude/skills/screens-check/linux.mjs`): one launch of
 * the GTK host per route, on the route's link, with the host capturing its own window. Here the
 * host is a stand-in that writes what it was given where it was asked to capture.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const script = new URL('../../.claude/skills/screens-check/linux.mjs', import.meta.url);
const { captureEnv, captureResult, shoot } = (await import(script.href)) as {
  captureEnv(
    env: Record<string, string | undefined>,
    state: string,
    file: string,
    input?: string,
  ): Record<string, string | undefined>;
  captureResult(log: string, scripted?: boolean): 'captured' | 'failed' | undefined;
  shoot(
    target: {
      host: string;
      bundle: string;
      scheme: string;
      out: string;
      input?: string;
      limitSeconds?: number;
    },
    route: string,
  ): Promise<string>;
};

function standIn(dir: string, body: string): string {
  const host = path.join(dir, 'ngn-linux');
  writeFileSync(host, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(host, 0o755);
  return host;
}

describe('the Linux screens mode', () => {
  it('launches the host on the route as its initial URL, on cairo, and returns its capture', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'screens-linux-'));
    try {
      const host = standIn(
        dir,
        [
          '[ "$GSK_RENDERER" = cairo ] && [ "$NGN_TESTS" = 1 ] && [ -d "$NGN_STATE_DIR" ] || exit 3',
          'echo "$*" > "$NGN_CAPTURE"',
          'echo "[ngn] captured $NGN_CAPTURE" >&2',
          'exec sleep 30',
        ].join('\n'),
      );
      const out = path.join(dir, 'out');
      const file = await shoot({ host, bundle: '/b/main.js', scheme: 'notes', out }, '/notes/1');
      assert.equal(file, path.join(out, 'notes-1.png'));
      assert.equal(
        readFileSync(file, 'utf8').trim(),
        '/b/main.js --url notes://notes/1 --title screens-check',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails a route with no capture, with the host's output", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'screens-linux-'));
    try {
      const host = standIn(dir, 'echo "Gdk-ERROR: no display" >&2; exit 1');
      await assert.rejects(
        shoot({ host, bundle: '/b.js', scheme: 'notes', out: dir, limitSeconds: 5 }, '/settings'),
        /No capture for \/settings\. The host's output:\nGdk-ERROR: no display/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('plays an input script before the capture, and names the capture after it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'screens-linux-'));
    try {
      const host = standIn(
        dir,
        [
          'echo "[ngn] input script done" >&2',
          'echo "$NGN_INPUT_SCRIPT" > "$NGN_CAPTURE"',
          'echo "[ngn] captured $NGN_CAPTURE" >&2',
          'exec sleep 30',
        ].join('\n'),
      );
      const out = path.join(dir, 'out');
      const input = path.join(dir, 'open-sheet.input');
      const file = await shoot({ host, bundle: '/b.js', scheme: 'notes', out, input }, '/overlays');
      assert.equal(file, path.join(out, 'overlays-open-sheet.png'));
      assert.equal(readFileSync(file, 'utf8').trim(), input);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails a route whose input script the host refuses, though it still captures', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'screens-linux-'));
    try {
      const host = standIn(
        dir,
        [
          'echo "[ngn] input script: an input script plays under X11 only" >&2',
          'echo x > "$NGN_CAPTURE"',
          'echo "[ngn] captured $NGN_CAPTURE" >&2',
          'exec sleep 30',
        ].join('\n'),
      );
      await assert.rejects(
        shoot(
          {
            host,
            bundle: '/b.js',
            scheme: 'notes',
            out: dir,
            input: '/s/a.input',
            limitSeconds: 5,
          },
          '/settings',
        ),
        /No capture for \/settings\. The host's output:\n\[ngn\] input script: an input script plays under X11 only/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails a route when the host cannot start', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'screens-linux-'));
    try {
      await assert.rejects(
        shoot(
          { host: path.join(dir, 'missing'), bundle: '/b.js', scheme: 'notes', out: dir },
          '/settings',
        ),
        /ENOENT/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads whether the host wrote its capture, after its input script when it has one', () => {
    assert.equal(captureResult('[ngn] captured /o/a.png\n', true), 'failed');
    assert.equal(
      captureResult('[ngn] input script done\n[ngn] captured /o/a.png\n', true),
      'captured',
    );
    assert.equal(captureResult('[ngn] input script x.input: cannot be read\n', true), 'failed');
    assert.equal(captureResult('[ngn] first frame 90 ms\n', true), undefined);
  });

  it('reads whether the host wrote its capture', () => {
    assert.equal(captureResult('[ngn] first frame 90 ms\n[ngn] captured /o/a.png\n'), 'captured');
    assert.equal(captureResult('[ngn] could not capture /o/a.png\n'), 'failed');
    assert.equal(captureResult('[ngn] first frame 90 ms\n'), undefined);
  });

  it('does not accept a capture logged before its input script finished', () => {
    assert.equal(
      captureResult('[ngn] captured /o/a.png\n[ngn] input script done\n', true),
      'failed',
    );
  });

  it('reports usage for an option given without its operand', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'screens-linux-'));
    try {
      const run = spawnSync(
        process.execPath,
        [
          fileURLToPath(script),
          ...['--host', '/h', '--bundle', '/b.js', '--scheme', 'notes', '--out', out],
          '/desktop',
          '--input',
        ],
        { encoding: 'utf8' },
      );
      assert.equal(run.status, 2);
      assert.match(run.stderr, /Usage: linux\.mjs/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('launches as a test launch with no accessibility bus, whatever the caller set', () => {
    const env = captureEnv({ GSK_RENDERER: 'vulkan', PATH: '/bin' }, '/s', '/o/a.png');
    assert.equal(env['GSK_RENDERER'], 'cairo');
    assert.equal(env['GTK_A11Y'], 'none');
    assert.equal(env['NGN_CAPTURE'], '/o/a.png');
    assert.equal(env['NGN_STATE_DIR'], '/s');
    assert.equal(env['PATH'], '/bin');
    assert.equal(env['NGN_INPUT_SCRIPT'], undefined);
    // A script of the caller's own is not played unless asked for.
    const scripted = captureEnv({ NGN_INPUT_SCRIPT: '/old.input' }, '/s', '/o/a.png', '/s/b.input');
    assert.equal(scripted['NGN_INPUT_SCRIPT'], '/s/b.input');
    assert.equal(
      captureEnv({ NGN_INPUT_SCRIPT: '/old.input' }, '/s', '/o/a.png')['NGN_INPUT_SCRIPT'],
      undefined,
    );
  });
});
