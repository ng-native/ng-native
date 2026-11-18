#!/usr/bin/env node
/**
 * The Linux mode of the screens-check skill: launches the GTK host once per route on its deep link
 * and has the host capture its own window in-process (`NGN_CAPTURE`), a second after its first
 * frame, with GSK's cairo renderer under Xvfb at scale 1 and the image's pinned fonts.
 *
 *   node .claude/skills/screens-check/linux.mjs --host <build>/gtk/ngn-linux --bundle main.js \
 *     --scheme notes --out "$out/shots/base" /settings /notes
 *
 * It runs in the AlmaLinux 9 image (`ngn-el9`), so a base and a change are drawn by the same GTK,
 * fonts and renderer whatever machine runs it: on a Mac it runs itself there (scripts/linux-image.mjs),
 * and the host, the bundle and the out folder must be under the home folder. On Linux it runs where
 * it is; run it in the image there too, for captures that compare with a Mac's.
 *
 * The link reaches the app as its initial URL (`--url`). Nothing here taps: a route whose screen
 * needs a tap to show what matters is a link of its own, or is checked by hand.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepLink, screenshotName } from './macos.mjs';
import { runInLinuxImage, startXvfb } from '../../../scripts/linux-image.mjs';

/** The host's environment for one capture: a test launch, cairo, and where the capture goes. */
export function captureEnv(env, state, file) {
  return {
    ...env,
    NGN_TESTS: '1',
    NGN_STATE_DIR: state,
    NGN_RUN_ID: `screens-${process.pid}`,
    NGN_TESTS_FAKE_SYSTEM_UI: '1',
    NGN_CAPTURE: file,
    GSK_RENDERER: 'cairo',
    GTK_A11Y: 'none',
  };
}

/** What the host logs once its capture is written, or could not be. @param {string} log */
export function captureResult(log) {
  if (/\[ngn\] captured /.test(log)) return 'captured';
  if (/\[ngn\] could not capture /.test(log)) return 'failed';
  return undefined;
}

/**
 * Launch the host on `route`, wait for its capture, and stop it.
 *
 * @param {{ host: string, bundle: string, scheme: string, out: string, limitSeconds?: number }} target
 * @param {string} route
 */
export async function shoot(target, route) {
  const file = path.join(target.out, screenshotName(route, []));
  const state = mkdtempSync(path.join(tmpdir(), 'screens-linux-'));
  mkdirSync(target.out, { recursive: true });
  const child = spawn(
    target.host,
    [target.bundle, '--url', deepLink(target.scheme, route), '--title', 'screens-check'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: captureEnv(process.env, state, file) },
  );
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    const limit = (target.limitSeconds ?? 30) * 1000;
    for (let waited = 0; waited < limit && !captureResult(log); waited += 200) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (captureResult(log) !== 'captured' || !existsSync(file)) {
      throw new Error(`No capture for ${route}. The host's output:\n${log}`);
    }
    return file;
  } finally {
    child.kill('SIGTERM');
    await exited;
    rmSync(state, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args.splice(at, 2)[1];
  };
  const host = option('--host') ?? process.env.NGN_DESKTOP_HOST;
  const bundle = option('--bundle');
  const scheme = option('--scheme');
  const out = option('--out');
  if (!host || !bundle || !scheme || !out || args.length === 0) {
    console.error(
      'Usage: linux.mjs --host <ngn-linux> --bundle <main.js> --scheme <scheme> --out <dir> <route>...',
    );
    process.exit(2);
  }
  const target = {
    host: path.resolve(host),
    bundle: path.resolve(bundle),
    scheme,
    out: path.resolve(out),
  };
  if (process.platform !== 'linux') {
    mkdirSync(target.out, { recursive: true });
    process.exit(
      runInLinuxImage(
        fileURLToPath(import.meta.url),
        [
          '--host',
          target.host,
          '--bundle',
          target.bundle,
          '--scheme',
          scheme,
          '--out',
          target.out,
          ...args,
        ],
        {
          mounts: [
            path.dirname(path.dirname(target.host)),
            path.dirname(target.bundle),
            target.out,
          ],
        },
      ),
    );
  }
  const stop = await startXvfb();
  try {
    for (const route of args) console.log(await shoot(target, route));
  } finally {
    stop();
  }
}
