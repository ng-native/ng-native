/**
 * What every canary screen sends native, from two checkouts, and where the two differ: each view
 * whose props changed, and each view that came or went, by its place in the screen.
 *
 * A change to how anything lays out or draws changes a committed prop, so the difference between
 * main and a pull request is every place a screen would look different. It is read in Node,
 * through the fake native side the tests use: native's own drawing, fonts and paint are not in it,
 * which a screenshot on a device is for.
 *
 * Usage:
 *
 *   node scripts/native-output.mjs write <dir>           # write this checkout's screens to <dir>
 *   node scripts/native-output.mjs write <dir> --checkout <path>  # another checkout's, this one's way
 *   node scripts/native-output.mjs diff <before> <after>  # what changed, as Markdown
 *   node scripts/native-output.mjs diff <before> <after> --json
 *
 * `write` builds the canary's Tailwind sheet first, as `node metro.config.js` does, and then runs
 * `examples/canary/src/native-output.test.ts`. `diff` exits 1 where anything changed.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
/** The test that renders each screen, from this checkout: both sides are written the same way. */
const HARNESS = 'examples/canary/src/native-output.test.ts';

/** The views listed for a screen, past which the rest are counted. */
const SHOWN = 20;

/** Each view's place in a screen, as the view names from the top: `RNSScreen[0] > View[2]`. */
const placeOf = (trail) => trail.map(({ view, at }) => `${view}[${at}]`).join(' > ');

/** A value as it is written in the report: short, and on one line. */
function written(value) {
  if (value === undefined) return '(none)';
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/**
 * Where two committed trees differ: a prop changed on a view in both, or a view one has and the
 * other has not. Children are compared by their place among their siblings, so one put in or
 * taken out moves those after it, and that is reported as what it is: every one after it changed.
 */
export function differences(before, after, trail = []) {
  const found = [];
  const count = Math.max(before.length, after.length);
  for (let at = 0; at < count; at++) {
    const was = before[at];
    const is = after[at];
    const here = [...trail, { view: (is ?? was).view, at }];
    if (!was) {
      found.push({ place: placeOf(here), kind: 'added' });
      continue;
    }
    if (!is) {
      found.push({ place: placeOf(here), kind: 'removed' });
      continue;
    }
    if (was.view !== is.view) {
      found.push({ place: placeOf(here), kind: 'replaced', from: was.view, to: is.view });
      continue;
    }
    const keys = new Set([...Object.keys(was.props), ...Object.keys(is.props)]);
    const props = [...keys]
      .filter((key) => JSON.stringify(was.props[key]) !== JSON.stringify(is.props[key]))
      .sort()
      .map((key) => ({ key, from: was.props[key], to: is.props[key] }));
    if (props.length) found.push({ place: placeOf(here), kind: 'props', props });
    found.push(...differences(was.children, is.children, here));
  }
  return found;
}

/** Each screen's file in a directory `write` filled, by name. */
function screens(dir) {
  return new Map(
    readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => [name, JSON.parse(readFileSync(path.join(dir, name), 'utf8'))]),
  );
}

/** Every screen in either directory, and what changed on each that did. */
export function compare(beforeDir, afterDir) {
  const before = screens(beforeDir);
  const after = screens(afterDir);
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  return names.map((name) => {
    const was = before.get(name);
    const is = after.get(name);
    const url = (is ?? was).url;
    if (!was || !is) return { url, missing: was ? 'after' : 'before', changes: [] };
    const notes =
      was.tailwind === is.tailwind ? [] : ['the Tailwind sheet was built on one side only'];
    // A screen that threw is compared by what it threw: the same throw on both sides is no change.
    if (was.threw || is.threw) {
      if (was.threw === is.threw) return { url, notes, changes: [], threw: is.threw };
      const how = is.threw
        ? `throws where it rendered: ${is.threw}`
        : `renders where it threw: ${was.threw}`;
      return { url, notes: [...notes, how], changes: [] };
    }
    return { url, notes, changes: differences(was.views, is.views) };
  });
}

/** The screens a run left out, and why, from the list `write` keeps beside them. */
export function skipped(dir) {
  const file = path.join(dir, 'skipped.txt');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

/** The comparison as Markdown, for a pull request's description. */
export function report(results, left = {}) {
  const changed = results.filter((one) => one.missing || one.changes.length || one.notes?.length);
  const lines = [`### Native output: ${changed.length} of ${results.length} screens changed`, ''];
  for (const one of changed) {
    if (one.missing) {
      lines.push(`- \`${one.url}\`: written only ${one.missing === 'after' ? 'before' : 'after'}`);
      continue;
    }
    lines.push(`- \`${one.url}\`: ${one.changes.length} changes`);
    for (const note of one.notes ?? []) lines.push(`  - ${note}`);
    for (const change of one.changes.slice(0, SHOWN)) {
      if (change.kind === 'props') {
        const props = change.props
          .map(({ key, from, to }) => `\`${key}\` ${written(from)} → ${written(to)}`)
          .join(', ');
        lines.push(`  - \`${change.place}\`: ${props}`);
      } else if (change.kind === 'replaced') {
        lines.push(`  - \`${change.place}\`: ${change.from} is now ${change.to}`);
      } else {
        lines.push(`  - \`${change.place}\`: ${change.kind}`);
      }
    }
    if (one.changes.length > SHOWN) lines.push(`  - and ${one.changes.length - SHOWN} more`);
  }
  const threw = results.filter((one) => one.threw);
  if (threw.length) {
    lines.push('', 'Not compared, as they throw in Node on both sides, the same way:');
    for (const one of threw) lines.push(`- \`${one.url}\`: ${one.threw}`);
  }
  const out = Object.entries(left);
  if (out.length) {
    lines.push('', 'Not compared, as they cannot be rendered in Node:');
    for (const [route, why] of out) lines.push(`- \`/${route}\`: ${why}`);
  }
  return lines.join('\n');
}

/**
 * A checkout's screens into `dir`, emptied first, written by this checkout's harness, which is put
 * in the other checkout for the run and taken out after. Throws where the run fails.
 */
function write(dir, checkout = ROOT) {
  const out = path.resolve(dir);
  const canary = path.join(checkout, 'examples/canary');
  const harness = path.join(checkout, HARNESS);
  const borrowed = checkout !== ROOT && !existsSync(harness);
  if (checkout !== ROOT) copyFileSync(path.join(ROOT, HARNESS), harness);
  rmSync(out, { recursive: true, force: true });
  const run = (command, args, env = {}) => {
    const result = spawnSync(command, args, {
      cwd: canary,
      stdio: 'inherit',
      env: { ...process.env, CI: '1', ...env },
    });
    if (result.status !== 0)
      throw new Error(`${command} ${args.join(' ')} exited ${result.status}`);
  };
  try {
    run(process.execPath, ['metro.config.js']);
    run('pnpm', ['exec', 'vitest', 'run', 'src/native-output.test.ts'], { NATIVE_OUTPUT: out });
  } finally {
    if (borrowed) rmSync(harness, { force: true });
  }
  // A screen that threw writes nothing: fewer files than routes is a failed run, not a smaller app.
  if (!existsSync(out) || !readdirSync(out).length) throw new Error(`no screens written to ${out}`);
}

function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'write' && rest[0]) {
    const at = rest.indexOf('--checkout');
    return write(rest[0], at === -1 ? ROOT : path.resolve(rest[at + 1]));
  }
  if (command === 'diff' && rest[0] && rest[1]) {
    const results = compare(rest[0], rest[1]);
    const left = { ...skipped(rest[0]), ...skipped(rest[1]) };
    console.log(rest.includes('--json') ? JSON.stringify(results, null, 2) : report(results, left));
    const changed = results.some((one) => one.missing || one.changes.length || one.notes?.length);
    process.exitCode = changed ? 1 : 0;
    return;
  }
  console.error('Usage: native-output.mjs write <dir> | diff <before> <after> [--json]');
  process.exitCode = 2;
}

if (import.meta.url === url.pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
