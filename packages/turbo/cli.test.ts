import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { workspace } from './test-workspace.ts';

const require = createRequire(import.meta.url);
const { main } = require('./cli.cjs');
const { installed } = require('./sync/index.cjs');

installed.find = (pkg: string) =>
  pkg === 'expo-haptics'
    ? { version: '58.0.1', native: true, plugin: false, peers: [], dir: '/expo-haptics' }
    : undefined;
installed.autoPlugins = () => [];

/** `main`, with what it prints kept rather than printed. */
async function run(args: string[], cwd: string) {
  const out: string[] = [];
  const { log, error } = console;
  console.log = console.error = (line: string) => out.push(line);
  try {
    return { code: await main(args, cwd), out: out.join('\n') };
  } finally {
    Object.assign(console, { log, error });
  }
}

describe('ng-native-turbo', () => {
  const unsynced = () =>
    workspace({
      'turbo.json': '{ "tasks": {} }',
      'apps/mobile/package.json': JSON.stringify({
        name: 'mobile',
        dependencies: { '@ng-native/platform': '0.25.0', ui: 'workspace:*' },
      }),
      'apps/mobile/app.json': '{ "expo": {} }',
      'packages/ui/package.json': JSON.stringify({
        name: 'ui',
        dependencies: { 'expo-haptics': '~58.0.0' },
      }),
    });

  it('fails a sync --check that would change an app, and changes nothing', async () => {
    // From inside the app, whose own turbo.json extends the root's and is not the workspace's.
    const files = unsynced();
    files.write('apps/mobile/turbo.json', '{ "extends": ["//"], "tasks": {} }');
    const before = files.read('apps/mobile/package.json');
    const { code, out } = await run(['sync', '--check'], `${files.root}/apps/mobile`);
    assert.equal(code, 1);
    assert.match(out, /apps\/mobile\/package\.json needs expo-haptics/);
    assert.equal(files.read('apps/mobile/package.json'), before);
  });

  it('syncs from anywhere in the workspace, after which the check passes', async () => {
    const files = unsynced();
    assert.equal((await run(['sync'], `${files.root}/packages/ui`)).code, 0);
    assert.equal(
      files.readJson('apps/mobile/package.json').dependencies['expo-haptics'],
      '~58.0.0',
    );
    assert.deepEqual(await run(['sync', '--check'], files.root), {
      code: 0,
      out: 'Every app lists the native modules it needs.',
    });
  });

  it('inits the workspace root above where it runs', async () => {
    const files = workspace({ 'apps/mobile/package.json': '{}' });
    assert.equal((await run(['init'], `${files.root}/apps/mobile`)).code, 0);
    assert.ok(files.exists('turbo.json'));
    assert.ok(files.exists('turbo/generators/config.ts'));
  });

  it('prints its usage, and fails on a command it does not know', async () => {
    assert.match((await run(['--help'], '/')).out, /^Usage: ng-native-turbo <command>/);
    const { code, out } = await run(['generate'], '/');
    assert.equal(code, 1);
    assert.match(out, /Unknown command: generate/);
  });
});
