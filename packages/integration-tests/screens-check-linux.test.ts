/**
 * The Linux mode of the screens-check skill (`.claude/skills/screens-check/linux.mjs`): one launch of
 * the GTK host per route, on the route's link, with the host capturing its own window. Here the
 * host is a stand-in that writes what it was given where it was asked to capture.
 */
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const script = new URL('../../.claude/skills/screens-check/linux.mjs', import.meta.url);
const { captureEnv, captureResult, shoot } = (await import(script.href)) as {
  captureEnv(
    env: Record<string, string | undefined>,
    state: string,
    file: string,
  ): Record<string, string | undefined>;
  captureResult(log: string): 'captured' | 'failed' | undefined;
  shoot(
    target: { host: string; bundle: string; scheme: string; out: string; limitSeconds?: number },
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

  it('reads whether the host wrote its capture', () => {
    assert.equal(captureResult('[ngn] first frame 90 ms\n[ngn] captured /o/a.png\n'), 'captured');
    assert.equal(captureResult('[ngn] could not capture /o/a.png\n'), 'failed');
    assert.equal(captureResult('[ngn] first frame 90 ms\n'), undefined);
  });

  it('launches as a test launch with no accessibility bus, whatever the caller set', () => {
    const env = captureEnv({ GSK_RENDERER: 'vulkan', PATH: '/bin' }, '/s', '/o/a.png');
    assert.equal(env['GSK_RENDERER'], 'cairo');
    assert.equal(env['GTK_A11Y'], 'none');
    assert.equal(env['NGN_CAPTURE'], '/o/a.png');
    assert.equal(env['NGN_STATE_DIR'], '/s');
    assert.equal(env['PATH'], '/bin');
  });
});
