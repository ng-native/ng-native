import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { classify } from './changes.mjs';

const camera = 'packages/desktop/native/appkit/tests/camera.test.mm';
const gtk = 'packages/desktop/native/gtk/tests/audio.test.cpp';
const article = 'apps/documentation/src/content/packages/desktop/packaging.md';
const example = 'examples/habits/README.md';
const script = fileURLToPath(new URL('./changes.mjs', import.meta.url));

function selected(files) {
  return Object.entries(classify(files))
    .filter(([, run]) => run)
    .map(([name]) => name);
}

test('public prose builds the site and internal prose only needs formatting', () => {
  assert.deepEqual(selected([article]), ['check-markdown', 'docs']);
  assert.deepEqual(selected([example]), ['docs']);
  assert.deepEqual(selected(['docs/ARCHITECTURE.md', '.claude/skills/work-issues/SKILL.md']), []);
  assert.deepEqual(selected(['packages/fabric/README.md', '.nx/version-plans/fix.md']), [
    'check-markdown',
  ]);
});

test('docs site code needs Nx and the site build', () => {
  assert.deepEqual(selected(['apps/documentation/build/markdown.ts', article]), [
    'workspace',
    'check-markdown',
    'docs',
  ]);
});

test('integration tests can change product coverage without changing a published package', () => {
  assert.deepEqual(selected(['packages/integration-tests/sticky-settle-clock.ts']), [
    'workspace',
    'coverage',
  ]);
});

test('the generator packages never build the canary', () => {
  for (const name of ['migrate', 'nx', 'schematics', 'turbo']) {
    const run = selected([`packages/${name}/index.cjs`]);
    assert.ok(run.includes('workspace'), name);
    assert.ok(!run.includes('native'), name);
    assert.ok(!run.includes('device'), name);
  }
});

test('native desktop test-only changes select their own OS', () => {
  assert.deepEqual(selected([camera]), ['desktop-macos']);
  assert.deepEqual(selected([gtk]), ['desktop-linux']);
  assert.deepEqual(selected([camera, gtk]), ['desktop-linux', 'desktop-macos']);
  const shared = selected(['packages/desktop/native/core/src/safe-areas.cpp']);
  assert.ok(!shared.includes('native'));
  assert.ok(!shared.includes('device'));
  assert.ok(selected(['packages/desktop/app.plugin.cjs']).includes('native'));
  for (const name of ['desktop-core', 'desktop-linux', 'desktop-macos', 'desktop-prebuilt-linux']) {
    assert.ok(shared.includes(name));
  }
});

test('runtime, registry, and setup changes keep their verification', () => {
  const runtime = selected(['packages/fabric/src/runtime.ts', article]);
  for (const name of ['workspace', 'coverage', 'published', 'docs', 'native', 'device']) {
    assert.ok(runtime.includes(name));
  }
  assert.ok(selected(['packages/components/fixtures/sample.md']).includes('published'));
  assert.ok(selected(['template-desktop/package.json']).includes('published'));
  assert.ok(selected(['scripts/verify-publish.mjs']).includes('published'));
  assert.ok(selected(['.github/actions/setup/action.yml']).includes('device'));
  assert.ok(selected(['.github/actions/ci-changes/changes.mjs']).includes('desktop-core'));
  assert.deepEqual(selected(['.github/workflows/device-tests.yml']), ['device']);
  assert.deepEqual(selected(['.github/workflows/native.yml']), ['native']);
  assert.deepEqual(selected(['.github/workflows/docs.yml']), ['docs']);
  assert.deepEqual(selected(['.github/workflows/preview.yml']), ['published']);
  assert.equal(classify(['pnpm-lock.yaml'], false)['desktop-linux'], false);
  assert.equal(classify(['pnpm-lock.yaml'])['desktop-linux'], true);
});

function inRepository(verify) {
  const cwd = mkdtempSync(join(tmpdir(), 'ci-changes-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const write = (path, text) => writeFileSync(join(cwd, path), text);
  const save = (file) => {
    write(file, 'changed\n');
    git('add', file);
    git('commit', '-qm', file);
    return git('rev-parse', 'HEAD');
  };
  const execute = (event, env) => {
    write('outputs', '');
    const result = spawnSync(process.execPath, [script], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: cwd + delimiter + process.env.PATH,
        GITHUB_OUTPUT: join(cwd, 'outputs'),
        GITHUB_EVENT_NAME: event,
        GITHUB_REF_NAME: 'main',
        GITHUB_REPOSITORY: 'test/repository',
        GITHUB_WORKFLOW_REF: 'test/repository/.github/workflows/native.yml@refs/heads/main',
        ...env,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(join(cwd, 'outputs'), 'utf8');
  };
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'CI Test');
    git('config', 'user.email', 'ci@example.test');
    git('config', 'commit.gpgsign', 'false');
    verify({ git, save, write, execute, cwd });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('a docs push still selects mobile work from a cancelled earlier push', () => {
  inRepository(({ save, execute, cwd }) => {
    const lastGreen = save('README.md');
    const interrupted = save('tsconfig.base.json');
    save('CONTRIBUTING.md');
    writeFileSync(
      join(cwd, 'gh'),
      `#!/usr/bin/env node
const args = process.argv.slice(2);
for (const value of ['repos/test/repository/actions/workflows/native.yml/runs', 'event=push', 'status=success', 'branch=main']) {
  if (!args.includes(value)) process.exit(1);
}
if (process.env.GH_FAIL) process.exit(1);
console.log(JSON.stringify({workflow_runs: [{head_sha: process.env.LAST_GREEN}]}));
`,
      { mode: 0o755 },
    );
    const catchup = execute('push', { LAST_GREEN: lastGreen });
    assert.match(catchup, /native=true/);
    assert.match(catchup, new RegExp(`base=${lastGreen}`));
    assert.match(execute('push', { LAST_GREEN: interrupted }), /native=false/);
    assert.equal(execute('push', { GH_FAIL: '1' }), '');
    assert.equal(execute('push', { LAST_GREEN: '0'.repeat(40) }), '');
  });
});

test('a renamed input selects jobs for its deleted path and an unmatched head falls back', () => {
  inRepository(({ git, save, execute }) => {
    const base = save('tsconfig.base.json');
    git('switch', '-qc', 'pr');
    git('mv', 'tsconfig.base.json', 'README.md');
    git('commit', '-qm', 'Move to README');
    const pr = git('rev-parse', 'HEAD');
    git('switch', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', 'Merge PR for CI', 'pr');
    const outputs = execute('pull_request', { PR_HEAD: pr });
    assert.match(outputs, /published=true/);
    assert.match(outputs, /native=true/);
    assert.match(outputs, new RegExp(`base=${base}`));
    assert.equal(execute('pull_request', { PR_HEAD: base }), '');
  });
});
