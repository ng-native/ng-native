/**
 * Whether a pull request moved the version of anything the desktop host builds from, for the
 * Desktop host workflow's `changes` job. A lockfile edit that only touches other packages leaves
 * the host's compiled sources as they were, so it is no reason to build the host.
 *
 * Usage:
 *
 *   node scripts/desktop-host-pins.mjs <base ref>
 *
 * Compares the resolved versions in the base ref's pnpm-lock.yaml with the working tree's, prints
 * `true` or `false`, and writes it to the step's outputs as `pins`. Fails closed: a lockfile that
 * cannot be read at the base prints `true`.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The packages whose sources the host compiles in or against. */
export const HOST_PACKAGES = [
  'react-native',
  'react-native-screens',
  'react-native-safe-area-context',
  'react-native-svg',
  'react-native-webview',
  'react-native-worklets',
  'react-native-reanimated',
  'react-native-gesture-handler',
  'react-native-keyboard-controller',
  '@react-native-async-storage/async-storage',
];

/** `name@version` for each host package the lockfile resolves, sorted, one entry per version. */
export function hostPins(lockfile) {
  const body = lockfile.split(/^packages:\n/m)[1]?.split(/^snapshots:\n/m)[0] ?? '';
  const pins = new Set();
  for (const line of body.split('\n')) {
    // A `packages:` key, `  name@version:`, with no peer suffix; the names may be quoted.
    const match = /^ {2}'?(@?[^@\s']+)@([^:(\s']+)'?:\s*$/.exec(line);
    if (match && HOST_PACKAGES.includes(match[1])) pins.add(`${match[1]}@${match[2]}`);
  }
  return [...pins].sort();
}

export function pinsChanged(base, head) {
  const before = hostPins(base);
  const after = hostPins(head);
  return before.length !== after.length || before.some((pin, i) => pin !== after[i]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const ref = process.argv[2];
  let changed = true;
  try {
    if (!ref) throw new Error('usage: node scripts/desktop-host-pins.mjs <base ref>');
    const base = execFileSync('git', ['show', `${ref}:pnpm-lock.yaml`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    });
    changed = pinsChanged(base, readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
  } catch (error) {
    console.error(`desktop-host-pins: ${error.message}; building the host to be safe`);
  }
  console.log(String(changed));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `pins=${changed}\n`);
}
