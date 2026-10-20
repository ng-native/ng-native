/**
 * The checks a pull request passes before it opens and again before it merges, against the
 * branch it goes into, and a report of them for its description.
 *
 * What it checks, each against a checkout of the base made beside this one:
 *
 * - formatting, and lint, typecheck and tests of every project the change can reach;
 * - the tests that already existed and were changed or deleted, which the description says why of;
 * - that a change to a package's code comes with a version plan;
 * - what every canary screen sends native, on both sides (see `native-output.mjs`);
 * - the Node benchmarks, run in turn on each side so drift falls on both, against a limit.
 *
 * What it does not do is look at a device: for a change that draws, the `screens-check` skill
 * compares the screens whose native output changed on a simulator.
 *
 * Usage:
 *
 *   node scripts/pr-gate.mjs                       # against origin/main
 *   node scripts/pr-gate.mjs --base origin/main --rounds 3 --limit 3 --out gate.md
 *   node scripts/pr-gate.mjs --skip-bench          # all but the benchmarks
 *
 * It exits 1 where a check failed, and fails closed: a step that cannot run is a failed step.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

/** The benchmarks, each a script of `packages/integration-tests`. */
const BENCHES = ['bench', 'bench:tailwind', 'bench:screens'];

/**
 * A path whose change could be a change someone using the packages could see: code in a package,
 * but not its tests or fixtures, nor the integration tests, which ship nothing. Whether the
 * package publishes it is `published`'s to say.
 */
const SHIPPED =
  /^packages\/(?!integration-tests\/)[^/]+\/(?!.*\/fixtures\/).+\.(ts|cjs|mjs|js|css)$/;
const TEST = /\.test\.(ts|mts|mjs)$/;

export const USAGE = `Usage: node scripts/pr-gate.mjs [options]

Options:
  --base <ref>      the branch the change goes into (default: origin/main)
  --rounds <n>      benchmark rounds on each side (default: 3)
  --limit <percent> how much slower a benchmark may be (default: 3)
  --out <file>      also write the report to this file
  --skip-bench      run all but the benchmarks
  -h, --help        print this and exit
`;

/**
 * The options in `argv`, or `{ help: true }` for `--help`. Throws on a flag it does not know, one
 * missing its value, a benchmark number that is not one, or a stray argument, so a typo never runs the gate against the wrong base.
 */
export function options(argv) {
  const values = { '--base': 'origin/main', '--rounds': '3', '--limit': '3', '--out': undefined };
  let bench = true;
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--skip-bench') bench = false;
    else if (Object.hasOwn(values, arg)) {
      const next = argv[++at];
      if (next === undefined || next.startsWith('-')) throw new Error(`${arg} needs a value`);
      values[arg] = next;
    } else throw new Error(`unknown option ${arg}`);
  }
  const rounds = Number(values['--rounds']);
  const limit = Number(values['--limit']);
  if (!Number.isInteger(rounds) || rounds < 1)
    throw new Error('--rounds needs a positive whole number');
  if (!Number.isFinite(limit) || values['--limit'].trim() === '')
    throw new Error('--limit needs a number');
  return {
    base: values['--base'],
    rounds,
    limit,
    out: values['--out'],
    bench,
  };
}

/** A command's output, and whether it exited 0. Never throws: the caller reports the failure. */
function run(command, args, cwd = ROOT, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, CI: '1', FORCE_COLOR: '0', ...env },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { ok: result.status === 0, output, status: result.status };
}

/** The last lines of a failed command's output, for the report. */
const tail = (output, lines = 15) => output.trim().split('\n').slice(-lines).join('\n');

/**
 * The medians a benchmark printed, by name: `create median 12.34ms`, and the three of a Tailwind
 * line, `common first commit 1.2ms dark restyle 3.4ms token retheme 5.6ms`.
 */
export function medians(output) {
  const found = {};
  for (const line of output.split('\n')) {
    const tailwind =
      /^(\S+)\s+first commit\s+([\d.]+)ms\s+dark restyle\s+([\d.]+)ms\s+token retheme\s+([\d.]+)ms/.exec(
        line.trim(),
      );
    if (tailwind) {
      found[`${tailwind[1]} first commit`] = Number(tailwind[2]);
      found[`${tailwind[1]} dark restyle`] = Number(tailwind[3]);
      found[`${tailwind[1]} token retheme`] = Number(tailwind[4]);
      continue;
    }
    const plain = /^(.+?)\s+median\s+([\d.]+)ms/.exec(line.trim());
    if (plain) found[plain[1].trim()] = Number(plain[2]);
  }
  return found;
}

const middle = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * Each measure on each side, as the median of the rounds, and how much slower the change is. A
 * measure is slower where its median is past the limit and every round of the change was slower
 * than every round of the base: rounds that overlap are the machine, not the change. Two runs of
 * the same code differ by more than 3% on a busy machine, so the median alone would fail them.
 * A measure one side printed and the other did not is reported, and is not a regression.
 */
export function compareBenches(rounds, limit) {
  const names = new Set(
    rounds.flatMap(({ base, head }) => [...Object.keys(base), ...Object.keys(head)]),
  );
  return [...names].sort().map((name) => {
    const base = rounds.map((round) => round.base[name]).filter((x) => x !== undefined);
    const head = rounds.map((round) => round.head[name]).filter((x) => x !== undefined);
    if (!base.length || !head.length) return { name, missing: base.length ? 'change' : 'base' };
    const before = middle(base);
    const after = middle(head);
    const change = before === 0 ? 0 : ((after - before) / before) * 100;
    const apart = Math.min(...head) > Math.max(...base);
    // Past the limit with the rounds overlapping: not failed, and not to be read past either.
    return {
      name,
      before,
      after,
      change,
      slower: change > limit && apart,
      noisy: change > limit && !apart,
    };
  });
}

/** The tests that were there before and are changed, renamed or gone, from `git diff`. */
export function editedTests(nameStatus) {
  return nameStatus
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(([status, file]) => file && TEST.test(file) && /^[MDR]/.test(status))
    .map(([status, file, renamed]) => ({ status: status[0], file, renamed }));
}

/**
 * What each package publishes, by directory: the patterns of its package.json `files`, `null`
 * for one that is never published, and `undefined` for one with no `files`, which publishes all
 * of itself. A pattern naming what the package builds, `dist`, stands for what it is built from,
 * the `rootDir` of its tsconfig.build.json, since a change there is what changes it.
 */
function publishedPackages() {
  const dir = path.join(ROOT, 'packages');
  const found = {};
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name, 'package.json');
    if (!existsSync(file)) continue;
    const build = path.join(dir, name, 'tsconfig.build.json');
    found[name] = publishedOf(
      JSON.parse(readFileSync(file, 'utf8')),
      existsSync(build) ? JSON.parse(readFileSync(build, 'utf8')).compilerOptions : undefined,
    );
  }
  return found;
}

/**
 * What one package publishes, from its manifest and its tsconfig.build `compilerOptions`: see
 * `publishedPackages`. The build's output stands for its `rootDir`, and where that cannot be read,
 * or is the package itself, all of the package counts: the gate fails closed.
 *
 * ponytail: the build's `exclude` is not read, so a source file the build leaves out still asks
 * for a plan. That asks for one too many, never one too few.
 */
export function publishedOf(manifest, build) {
  if (manifest.private === true) return null;
  if (!Array.isArray(manifest.files)) return undefined;
  const bare = (pattern) => path.posix.normalize(pattern).replace(/(\/\*\*)?\/*$/, '');
  const out = build?.outDir ? bare(build.outDir) : 'dist';
  const isBuilt = (pattern) => bare(pattern) === out;
  if (!manifest.files.some(isBuilt)) return manifest.files;
  const source = build?.rootDir ? bare(build.rootDir) : '';
  if (!build?.outDir || source === '' || source === '.') return undefined;
  return manifest.files.map((pattern) => (isBuilt(pattern) ? source : pattern));
}

/**
 * Whether `file`, a path in `packages/<name>/`, is one its package publishes. A pattern matches
 * as npm reads `files`: as a glob from the package's own directory, against the file or any
 * directory it is in, which stands for everything in it.
 */
function published(file, packages) {
  const [, name = '', ...rest] = file.split('/');
  if (!Object.hasOwn(packages, name) || packages[name] === undefined) return true;
  if (packages[name] === null) return false;
  const parts = rest;
  const within = parts.map((_, at) => parts.slice(0, at + 1).join('/'));
  return packages[name].some((pattern) => {
    const glob = path.posix.normalize(pattern).replace(/\/+$/, '');
    return within.some((candidate) => path.posix.matchesGlob(candidate, glob));
  });
}

/** Whether a change to what is shipped comes with a version plan. */
export function needsPlan(nameStatus, packages = publishedPackages()) {
  const files = nameStatus
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(([, file]) => file);
  const shipped = files.some(
    ([, file]) => SHIPPED.test(file) && !TEST.test(file) && published(file, packages),
  );
  const plan = files.some(
    ([status, file]) => status === 'A' && file.startsWith('.nx/version-plans/'),
  );
  return shipped && !plan;
}

/** A checkout of `ref` beside this one, with its dependencies, and what removes it. */
function baseCheckout(ref) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pr-gate-base-'));
  const add = run('git', ['worktree', 'add', '--detach', dir, ref]);
  if (!add.ok) throw new Error(`could not check out ${ref}:\n${tail(add.output)}`);
  const remove = () => {
    run('git', ['worktree', 'remove', '--force', dir]);
    rmSync(dir, { recursive: true, force: true });
  };
  const install = run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], dir);
  if (!install.ok) {
    remove();
    throw new Error(`could not install ${ref}:\n${tail(install.output)}`);
  }
  return { dir, remove };
}

function main() {
  const opts = options(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const lines = [];
  let failed = false;
  const check = (name, ok, detail = '') => {
    lines.push(`- ${ok ? '✅' : '❌'} ${name}${detail ? `: ${detail}` : ''}`);
    if (!ok) failed = true;
  };

  // A remote branch is fetched first, so the base is what it is now and not when it was last fetched.
  const remote = /^([^/]+)\/(.+)$/.exec(opts.base);
  if (remote && run('git', ['remote', 'get-url', remote[1]]).ok) {
    const fetched = run('git', ['fetch', remote[1], remote[2]]);
    if (!fetched.ok) throw new Error(`could not fetch ${opts.base}:\n${tail(fetched.output)}`);
  }
  const fork = run('git', ['merge-base', opts.base, 'HEAD']);
  if (!fork.ok) throw new Error(`no merge base with ${opts.base}:\n${tail(fork.output)}`);
  const mergeBase = fork.output.trim();
  const head = run('git', ['rev-parse', '--short', 'HEAD']).output.trim();
  lines.push(
    `## Gate report`,
    '',
    `\`${head}\` against \`${opts.base}\` (\`${mergeBase.slice(0, 8)}\`)`,
    '',
  );

  const diffed = run('git', ['diff', '--name-status', `${mergeBase}...HEAD`]);
  if (!diffed.ok) throw new Error(`could not list the change's files:\n${tail(diffed.output)}`);
  const changes = diffed.output;

  // 1. Formatting, then everything the change can reach.
  lines.push('### Checks', '');
  const format = run('pnpm', ['format:check']);
  check(
    '`pnpm format:check`',
    format.ok,
    format.ok ? '' : `\n\n\`\`\`\n${tail(format.output)}\n\`\`\``,
  );
  const affected = run('pnpm', [
    'nx',
    'affected',
    '-t',
    'lint',
    'typecheck',
    'test',
    `--base=${mergeBase}`,
    '--nx-bail=false',
  ]);
  check(
    'lint, typecheck and test of every affected project',
    affected.ok,
    affected.ok ? '' : `\n\n\`\`\`\n${tail(affected.output, 30)}\n\`\`\``,
  );

  // 2. Tests that were there before: each one changed is in the description with why.
  const edited = editedTests(changes);
  check(
    'existing tests changed or deleted',
    true,
    edited.length ? `${edited.length}, each to be explained in the description` : 'none',
  );
  for (const one of edited) {
    lines.push(`  - ${{ M: 'changed', D: 'deleted', R: 'renamed' }[one.status]} \`${one.file}\``);
  }

  // 3. A change someone using the packages could see has a version plan.
  const plan = needsPlan(changes);
  check('version plan', !plan, plan ? 'a package changed and no plan was added' : '');

  const base = baseCheckout(mergeBase);
  try {
    // 4. What every canary screen sends native, on both sides.
    lines.push('');
    const out = mkdtempSync(path.join(tmpdir(), 'pr-gate-native-'));
    const script = path.join(ROOT, 'scripts/native-output.mjs');
    const before = run(process.execPath, [
      script,
      'write',
      path.join(out, 'base'),
      '--checkout',
      base.dir,
    ]);
    const after = run(process.execPath, [script, 'write', path.join(out, 'head')]);
    if (!before.ok || !after.ok) {
      check(
        'native output written on both sides',
        false,
        tail((before.ok ? after : before).output),
      );
    } else {
      const diff = run(process.execPath, [
        script,
        'diff',
        path.join(out, 'base'),
        path.join(out, 'head'),
      ]);
      // A change of what screens send native is not a failure, it is what review reads; a diff
      // that could not compare is.
      if (diff.status === 0 || diff.status === 1) lines.push(diff.output.trim());
      else check('native output compared', false, tail(diff.output));
    }
    rmSync(out, { recursive: true, force: true });

    // 5. The benchmarks, a side at a time, round after round.
    lines.push('', '### Benchmarks', '');
    const rounds = [];
    if (!opts.bench) lines.push('Not run (`--skip-bench`).');
    else {
      // A benchmark that fails is a failed check, and the rest of the report still goes out.
      let broke = null;
      benches: for (let round = 0; round < opts.rounds; round++) {
        const sides = { base: {}, head: {} };
        for (const [side, dir] of [
          ['base', base.dir],
          ['head', ROOT],
        ]) {
          for (const bench of BENCHES) {
            const result = run('pnpm', [bench], path.join(dir, 'packages/integration-tests'));
            if (!result.ok) {
              broke = { name: `\`${bench}\` on the ${side}`, output: result.output };
              break benches;
            }
            Object.assign(sides[side], medians(result.output));
          }
        }
        rounds.push(sides);
      }
      if (broke) check(`${broke.name} ran`, false, `\n\n\`\`\`\n${tail(broke.output)}\n\`\`\``);
    }
    if (opts.bench && rounds.length === opts.rounds) {
      const compared = compareBenches(rounds, opts.limit);
      lines.push(
        `Medians of ${opts.rounds} rounds, run in turn; slower by more than ${opts.limit}% fails.`,
        '',
        '| measure | base | change | difference |',
        '| --- | --- | --- | --- |',
      );
      for (const one of compared) {
        if (one.missing) {
          lines.push(
            `| ${one.name} | | | printed by the ${one.missing === 'base' ? 'change' : 'base'} only |`,
          );
          continue;
        }
        const sign = one.change > 0 ? '+' : '';
        const mark = one.slower ? ' ❌' : one.noisy ? ' ⚠️ rounds overlap, run more' : '';
        lines.push(
          `| ${one.name} | ${one.before.toFixed(2)}ms | ${one.after.toFixed(2)}ms | ${sign}${one.change.toFixed(1)}%${mark} |`,
        );
      }
      const slower = compared.filter((one) => one.slower);
      lines.push('');
      check(
        `benchmarks within ${opts.limit}%`,
        !slower.length,
        slower.map((one) => one.name).join(', '),
      );
    }
  } finally {
    base.remove();
  }

  lines.push(
    '',
    '### By hand',
    '',
    '- [ ] the iOS screens, with the `screens-check` skill, for a change that draws',
    '- [ ] the `review-change` skill on the final diff',
  );
  const text = lines.join('\n');
  if (opts.out) writeFileSync(opts.out, `${text}\n`);
  console.log(text);
  process.exitCode = failed ? 1 : 0;
}

if (import.meta.url === url.pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    console.error(`pr-gate: ${error.message}`);
    if (/^(unknown option|--\w[\w-]* needs a )/.test(error.message)) console.error(`\n${USAGE}`);
    process.exitCode = 1;
  }
}
