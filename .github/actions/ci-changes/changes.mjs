import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pinsChanged } from '../../../scripts/desktop-host-pins.mjs';

const internalProse =
  /^(?:[^/]+\.md$|(?:docs|\.claude|\.github|\.nx\/version-plans)\/.*\.md$|(?:packages|examples)\/[^/]+\/README\.md$)/;
// A few integration tests read repository Markdown and compile the public guide samples.
const markdownChecks = /^(?:README\.md|packages\/[^/]+\/README\.md)$/;
const docsProse = /^apps\/documentation\/src\/(?:content\/.*|learn\/lessons\/[^/]+\/lesson)\.md$/;
const appkitTest = 'packages/desktop/native/appkit/tests/';
const gtkTest = 'packages/desktop/native/gtk/tests/';
const osTest = (file) => file.startsWith(appkitTest) || file.startsWith(gtkTest);
const workflowFiles = '.github/workflows/';
const tooling = /^\.github\/actions\/(?:setup|ci-changes)\//;
const mobileIrrelevant =
  /^(?:apps\/documentation\/|examples\/(?!canary\/)|packages\/(?:eslint-plugin|integration-tests|migrate|nx|schematics|turbo)\/|template(?:-desktop)?\/)/;
const desktopInputs =
  /^(?:packages\/desktop\/|packages\/testing\/(?:device\/fake-portals\.py|src\/device\/(?:fake-portals\.node\.test\.ts|linux-launcher\.ts))$|\.github\/workflows\/desktop\.yml$|\.github\/actions\/desktop-prebuilt(?:-linux)?\/|scripts\/desktop-host-pins\.mjs$|pnpm-workspace\.yaml$)/;

export function classify(files, desktopPinsChanged = true) {
  const matches = (predicate) => files.some(predicate);
  const product = (file) => !internalProse.test(file) && !docsProse.test(file) && !osTest(file);
  const workspace = (file) =>
    product(file) && (!file.startsWith(workflowFiles) || file === `${workflowFiles}ci.yml`);
  const mobile = (file, workflow) =>
    product(file) &&
    !mobileIrrelevant.test(file) &&
    // The canary uses the desktop package's Expo plugin, but never builds the desktop host.
    !file.startsWith('packages/desktop/native/') &&
    !file.startsWith('packages/desktop/bin/') &&
    !file.startsWith('.github/actions/desktop-prebuilt') &&
    !/^scripts\/(?:ci-telemetry|coverage|desktop-host-pins|verify-publish)\.mjs$/.test(file) &&
    (!file.startsWith(workflowFiles) || file === `${workflowFiles}${workflow}.yml`);
  const desktop = (file) =>
    !internalProse.test(file) &&
    (desktopInputs.test(file) ||
      tooling.test(file) ||
      (file === 'pnpm-lock.yaml' && desktopPinsChanged));

  return {
    workspace: matches(workspace),
    coverage: matches((file) => workspace(file) && !file.startsWith('apps/documentation/')),
    published: matches(
      (file) =>
        product(file) &&
        !file.startsWith('packages/integration-tests/') &&
        (/^(?:packages\/|template(?:-desktop)?\/|scripts\/verify-publish\.mjs$|verdaccio\.yaml$|package\.json$|pnpm-(?:lock|workspace)\.yaml$|nx\.json$|tsconfig[^/]*\.json$|\.nvmrc$|\.github\/workflows\/(?:ci|preview)\.yml$)/.test(
          file,
        ) ||
          tooling.test(file)),
    ),
    'check-markdown': matches((file) => docsProse.test(file) || markdownChecks.test(file)),
    // The site embeds example sources (including Markdown) and reads package sources at build time.
    docs: matches(
      (file) =>
        file.startsWith('apps/documentation/') ||
        file.startsWith('examples/') ||
        (product(file) &&
          !file.startsWith('packages/integration-tests/') &&
          (!file.startsWith(workflowFiles) || file === `${workflowFiles}docs.yml`)),
    ),
    native: matches((file) => mobile(file, 'native')),
    device: matches((file) => mobile(file, 'device-tests')),
    'desktop-core': matches((file) => desktop(file) && !osTest(file)),
    'desktop-linux': matches((file) => desktop(file) && !file.startsWith(appkitTest)),
    'desktop-macos': matches((file) => desktop(file) && !file.startsWith(gtkTest)),
    'desktop-prebuilt-linux': matches((file) => desktop(file) && !osTest(file)),
  };
}

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trimEnd();
}

function commit(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Missing or invalid commit SHA');
  return sha;
}

function lastSuccessfulPush() {
  const { GITHUB_REPOSITORY, GITHUB_WORKFLOW_REF, GITHUB_REF_NAME } = process.env;
  const workflow = /\/([^/@]+\.ya?ml)@/.exec(GITHUB_WORKFLOW_REF)?.[1];
  if (!workflow) throw new Error('Missing workflow file');
  const result = run('gh', [
    'api',
    '--method',
    'GET',
    `repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow}/runs`,
    '-f',
    'event=push',
    '-f',
    `branch=${GITHUB_REF_NAME}`,
    '-f',
    'status=success',
    '-f',
    'per_page=1',
  ]);
  return JSON.parse(result).workflow_runs[0]?.head_sha;
}

function revisionRange() {
  const head = commit(run('git', ['rev-parse', 'HEAD']));
  switch (process.env.GITHUB_EVENT_NAME) {
    case 'pull_request':
      // Compare the merge result actually checked by CI with its base parent. A changed
      // base branch can move between the event payload and checkout.
      if (run('git', ['rev-parse', 'HEAD^2']) !== commit(process.env.PR_HEAD)) {
        throw new Error('The checked-out merge commit does not match the pull request head');
      }
      return [commit(run('git', ['rev-parse', 'HEAD^1'])), head];
    case 'push': {
      // A cancelled or failed push can leave relevant work for the next run on main.
      const previous = lastSuccessfulPush();
      if (!previous || previous === head) return;
      const base = commit(previous);
      run('git', ['merge-base', '--is-ancestor', base, head]);
      return [base, head];
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const range = revisionRange();
    if (range) {
      const [base, head] = range;
      // Use both paths of a rename, including the deleted path's suite.
      const files = run('git', ['diff', '--name-only', '--no-renames', '-z', base, head])
        .split('\0')
        .filter(Boolean);
      const desktopPinsChanged =
        process.env.COMPARE_DESKTOP_PINS !== 'true' ||
        !files.includes('pnpm-lock.yaml') ||
        pinsChanged(
          run('git', ['show', `${base}:pnpm-lock.yaml`]),
          run('git', ['show', `${head}:pnpm-lock.yaml`]),
        );
      const outputs = Object.entries({ ...classify(files, desktopPinsChanged), base, head });
      console.log(`Compared ${base}..${head} (${files.length} changed files)`);
      console.log(Object.fromEntries(outputs));
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        outputs.map(([name, value]) => `${name}=${value}\n`).join(''),
      );
    } else {
      console.log('No earlier successful push to compare. Running all checks.');
    }
  } catch (error) {
    // Jobs skip only on an explicit false. An unavailable comparison cannot skip a check.
    console.log(
      `::warning::Could not classify changes. Running all checks. ${error.message.split('\n')[0]}`,
    );
  }
}
