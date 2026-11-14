#!/usr/bin/env node
/**
 * The macOS mode of the screens-check skill: opens each route of a desktop app by deep link, waits
 * for the host window to stop changing, and captures that window alone with `screencapture -l`.
 *
 *   node .claude/skills/screens-check/macos.mjs --app /path/Canary.app --scheme canary \
 *     --out "$out/shots/base" /overlays /forms
 *
 * One launch per route, as the iOS mode terminates and reopens the app: a new instance of the app
 * is opened on the link (`open -n -a <app> <link>`), captured, and quit, so no route sees the
 * state of the one before. The app must be a packaged `.app` (`ng-native-desktop package --format
 * app`), because only a packaged app has its URL scheme registered with LaunchServices.
 *
 * `screencapture` needs the Screen Recording permission for the terminal running this. The
 * window is captured as it is, with its own shadow left out (`-o`), at the display's scale, and
 * the PNG is Display P3: compare a base and a change captured on this Mac in this sitting, never
 * against a capture from another display.
 *
 * Nothing here taps. A route whose screen needs a tap to show what matters is a link of its own,
 * or is checked by hand.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ id: number, pid: number, layer: number, onscreen: boolean, width: number, height: number }} WindowInfo */

/** Smaller than this is a sliver (a shadow, a hidden title bar), not the app's window. */
const MIN_SIDE = 100;

/**
 * The host's window: the largest on-screen normal window (layer 0) of its process.
 *
 * @param {WindowInfo[]} windows
 * @param {number} pid
 * @returns {WindowInfo | undefined}
 */
export function hostWindow(windows, pid) {
  return windows
    .filter(
      (one) =>
        one.pid === pid &&
        one.layer === 0 &&
        one.onscreen &&
        one.width >= MIN_SIDE &&
        one.height >= MIN_SIDE,
    )
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];
}

/**
 * Two captures a second apart that are the same: the screen has stopped changing.
 *
 * @param {string | undefined} previous
 * @param {string} current
 */
export function settled(previous, current) {
  return previous !== undefined && previous === current;
}

/**
 * @param {string} scheme
 * @param {string} route
 */
export function deepLink(scheme, route) {
  return `${scheme}://${route.replace(/^\/+/, '')}`;
}

/**
 * What `open` is given: a new instance of the app on the link, so a link reaches a launch of its
 * own and not whichever instance is already running.
 *
 * @param {{ app: string }} target
 * @param {string} link
 */
export function openArguments(target, link) {
  return ['-n', '-a', target.app, link];
}

/**
 * One file per route and tapped label, named as the iOS mode names them.
 *
 * @param {string} route
 * @param {string[]} labels
 */
export function screenshotName(route, labels) {
  const name = [route.replace(/^\/+/, ''), ...labels]
    .join(' ')
    .replace(/[/ ]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${name || 'home'}.png`;
}

/** Every window the system has, with the fields `hostWindow` reads. @returns {WindowInfo[]} */
export function systemWindows() {
  // CGWindowListCopyWindowInfo through JavaScript for Automation: ids, owners and sizes need no
  // permission, only window names do.
  const script = `
    ObjC.import('CoreGraphics');
    const list = ObjC.deepUnwrap(ObjC.castRefToObject(
      $.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, $.kCGNullWindowID)));
    JSON.stringify(list.map((w) => ({
      id: w.kCGWindowNumber, pid: w.kCGWindowOwnerPID, layer: w.kCGWindowLayer,
      onscreen: Boolean(w.kCGWindowIsOnscreen),
      width: w.kCGWindowBounds.Width, height: w.kCGWindowBounds.Height,
    })));`;
  const run = spawnSync('osascript', ['-l', 'JavaScript', '-e', script], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`Could not list windows: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The app's executable, from its Info.plist. @param {string} app */
function executableOf(app) {
  const run = spawnSync(
    'plutil',
    ['-extract', 'CFBundleExecutable', 'raw', path.join(app, 'Contents/Info.plist')],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) throw new Error(`${app} has no Info.plist with CFBundleExecutable`);
  return path.join(app, 'Contents/MacOS', run.stdout.trim());
}

/** Pids of the running process whose executable is `executable`. @param {string} executable */
function pidsOf(executable) {
  const run = spawnSync('pgrep', ['-f', executable], { encoding: 'utf8' });
  return run.stdout.split('\n').filter(Boolean).map(Number);
}

/**
 * Open `route`, capture the host window once it has stopped changing, quit the app.
 *
 * @param {{ app: string, scheme: string, out: string, settleSeconds?: number }} target
 * @param {string} route
 */
export async function shoot(target, route) {
  const executable = executableOf(target.app);
  const before = new Set(pidsOf(executable));
  const file = path.join(target.out, screenshotName(route, []));
  mkdirSync(target.out, { recursive: true });
  const open = spawnSync('open', openArguments(target, deepLink(target.scheme, route)));
  if (open.status !== 0) throw new Error(`open failed for ${route}: ${open.stderr}`);
  let pid;
  try {
    // The new instance's pid: the one that was not running before the open.
    for (let waited = 0; waited < 20_000 && pid === undefined; waited += 250) {
      pid = pidsOf(executable).find((one) => !before.has(one));
      if (pid === undefined) await sleep(250);
    }
    if (pid === undefined) throw new Error(`${target.app} did not start for ${route}`);
    let last;
    for (let second = 0; second < (target.settleSeconds ?? 20); second++) {
      await sleep(1000);
      const window = hostWindow(systemWindows(), pid);
      if (!window) continue;
      const capture = spawnSync('screencapture', ['-x', '-o', '-l', String(window.id), file]);
      if (capture.status !== 0) throw new Error(`screencapture failed: ${capture.stderr}`);
      const digest = createHash('md5').update(readFileSync(file)).digest('hex');
      if (settled(last, digest)) return file;
      last = digest;
    }
    if (last === undefined) throw new Error(`No window for ${route}: the app did not show one`);
    return file; // never settled (a spinner, a looping animation): taken at the limit
  } finally {
    if (pid !== undefined) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args.splice(at, 2)[1];
  };
  const app = option('--app');
  const scheme = option('--scheme');
  const out = option('--out');
  if (!app || !scheme || !out || args.length === 0) {
    console.error('Usage: macos.mjs --app <App.app> --scheme <scheme> --out <dir> <route>...');
    process.exit(2);
  }
  for (const route of args) console.log(await shoot({ app, scheme, out }, route));
}
