/**
 * `node wpt/fetch.mjs`: check out the pinned commit of Web Platform Tests into `wpt/.cache`,
 * only the directories `pin.mjs` names.
 *
 * Fails closed. A fetch that fails, a checkout that is another commit, a directory that came
 * back empty or a file git lists that is not on disk all exit non-zero and leave no stamp, and
 * the runner does not run without the stamp.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE, CHECKOUT, COMMIT, REPOSITORY, STAMP, SUITES, SUPPORT } from './pin.mjs';

const gitIn = (checkout, ...args) =>
  execFileSync('git', ['-C', checkout, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 256 * 1024 * 1024,
  });
const git = (...args) => gitIn(CHECKOUT, ...args);

/** What a fetch that finished is stamped with: the commit and the directories asked for. */
const wanted = () => ({ commit: COMMIT, paths: [...SUITES, ...SUPPORT] });

/**
 * Whether the checkout is the one `pin.mjs` asks for, whole: a fetch finished, it was of this
 * commit and these directories, and the checkout it stamped is still there.
 */
export function fetched() {
  if (!existsSync(STAMP)) return false;
  try {
    const { files, ...stamped } = JSON.parse(readFileSync(STAMP, 'utf8'));
    return (
      files > 0 &&
      JSON.stringify(stamped) === JSON.stringify(wanted()) &&
      existsSync(join(CHECKOUT, 'resources/testharness.js'))
    );
  } catch {
    return false;
  }
}

/**
 * Every file git says a checkout has, each checked to be on disk and not empty where it matters.
 * Answers how many there are, and throws on the first thing wrong.
 */
export function verify(
  checkout = CHECKOUT,
  commit = COMMIT,
  directories = [...SUITES, ...SUPPORT],
) {
  const git = (...args) => gitIn(checkout, ...args);
  const head = git('rev-parse', 'HEAD').trim();
  if (head !== commit) throw new Error(`checked out ${head}, not the pinned ${commit}`);
  // `H` is a file checked out; `S` is one the sparse checkout leaves out.
  const files = git('ls-files', '-t', '-z')
    .split('\0')
    .filter((entry) => entry.startsWith('H '))
    .map((entry) => entry.slice(2));
  for (const directory of directories) {
    const count = files.filter((file) => file.startsWith(`${directory}/`)).length;
    if (count === 0) throw new Error(`${directory} came back with no files`);
  }
  for (const file of files) {
    if (!existsSync(join(checkout, file))) throw new Error(`${file} is listed but not on disk`);
  }
  const harness = join(checkout, 'resources/testharness.js');
  if (!existsSync(harness) || statSync(harness).size < 100_000) {
    throw new Error('resources/testharness.js is truncated');
  }
  if (git('status', '--porcelain').trim() !== '') throw new Error('the checkout is not clean');
  return files.length;
}

function checkOut() {
  rmSync(CACHE, { recursive: true, force: true });
  mkdirSync(CHECKOUT, { recursive: true });
  git('init', '--quiet');
  git('remote', 'add', 'origin', REPOSITORY);
  git('sparse-checkout', 'set', '--cone', ...SUITES, ...SUPPORT);
  git('fetch', '--quiet', '--depth', '1', '--filter=blob:none', 'origin', COMMIT);
  git('-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD');
}

function main() {
  if (fetched() && !process.argv.includes('--force')) {
    console.log(`wpt ${COMMIT.slice(0, 12)} is already fetched`);
    return;
  }
  checkOut();
  const files = verify();
  // Last, and only once all of it checked out: the runner reads this before it reads a test.
  writeFileSync(STAMP, `${JSON.stringify({ ...wanted(), files })}\n`);
  console.log(`fetched wpt ${COMMIT.slice(0, 12)}: ${files} files`);
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    main();
  } catch (error) {
    rmSync(STAMP, { force: true });
    console.error(`wpt fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
