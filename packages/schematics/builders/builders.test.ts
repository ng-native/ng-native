/**
 * The builders: which CLI they find, what they hand it, and what they report back to `ng`.
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const { expoArgs } = require('./expo.cjs');
const { vitestArgs } = require('./vitest.cjs');
const { resolveBin, spawnBin } = require('./spawn-bin.cjs');
const typecheck = require('./typecheck.cjs') as {
  runTypecheck(context: object): Promise<{ success: boolean; error?: string }>;
};

describe('expo', () => {
  it('passes the command and its arguments through as they are', () => {
    assert.deepEqual(expoArgs({ command: 'export', args: ['--output-dir', '../../dist/native'] }), [
      'export',
      '--output-dir',
      '../../dist/native',
    ]);
  });

  it('turns the options ng can take on the command line into flags', () => {
    assert.deepEqual(expoArgs({ command: 'start', port: 8082, clear: true }), [
      'start',
      '--port',
      '8082',
      '--clear',
    ]);
    assert.deepEqual(expoArgs({ command: 'export', platform: 'ios' }), [
      'export',
      '--platform',
      'ios',
    ]);
  });
});

describe('vitest', () => {
  it('runs once unless asked to watch', () => {
    assert.deepEqual(vitestArgs({}), ['run']);
    assert.deepEqual(vitestArgs({ watch: true, filter: 'settings' }), ['watch', 'settings']);
  });
});

/** A project directory with a fake CLI installed in it, so the real resolution and spawn run. */
function projectWith(bin: string, source: string) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ng-native-builder-')));
  const pkg = path.join(root, 'node_modules', 'fake-cli');
  mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: 'fake-cli', bin, exports: { '.': './index.js' } }),
  );
  writeFileSync(path.join(pkg, 'bin', 'cli.cjs'), source);
  return root;
}

function context(root: string) {
  const logged: string[] = [];
  return {
    logged,
    workspaceRoot: path.dirname(root),
    target: { project: 'native' },
    getProjectMetadata: async () => ({ root: path.basename(root) }),
    logger: { info: (line: string) => logged.push(line) },
  };
}

describe('the CLI a builder runs', () => {
  it('is found one node_modules at a time, even when an exports map hides its bin and manifest', () => {
    const root = projectWith('./bin/cli.cjs', '');
    assert.equal(
      resolveBin('fake-cli', root),
      path.join(root, 'node_modules/fake-cli/bin/cli.cjs'),
    );
  });

  it('takes the entry named for the package when the bin field lists several', () => {
    const root = projectWith('./bin/cli.cjs', '');
    writeFileSync(
      path.join(root, 'node_modules/fake-cli/package.json'),
      JSON.stringify({ name: 'fake-cli', bin: { other: './x', 'fake-cli': './bin/cli.cjs' } }),
    );
    assert.equal(
      resolveBin('fake-cli', root),
      path.join(root, 'node_modules/fake-cli/bin/cli.cjs'),
    );
  });

  it("runs in the project's directory and succeeds when the CLI does", async () => {
    const root = projectWith(
      './bin/cli.cjs',
      "require('node:fs').writeFileSync('ran.json', JSON.stringify(process.argv.slice(2)));",
    );
    const ctx = context(root);
    const result = await spawnBin('fake-cli', ['export', '--platform', 'ios'], ctx);
    assert.deepEqual(result, { success: true });
    assert.deepEqual(require(path.join(root, 'ran.json')), ['export', '--platform', 'ios']);
    assert.match(ctx.logged[0]!, /^fake-cli export --platform ios {2}\(in ng-native-builder-/);
  });

  it(
    'stops the CLI when it is stopped, instead of leaving Metro on its port',
    { timeout: 10_000 },
    async () => {
      // A supervisor, CI or an IDE's task runner sends SIGTERM to ng alone, not its process group.
      const root = projectWith(
        './bin/cli.cjs',
        // Gives up on its own after a few seconds, so a failure here cannot leave it behind.
        "require('node:fs').writeFileSync('started', ''); setTimeout(() => {}, 5000);",
      );
      const running = spawnBin('fake-cli', [], context(root));
      while (!existsSync(path.join(root, 'started'))) await new Promise((r) => setTimeout(r, 20));
      const listeners = process.listeners('SIGTERM');
      assert.equal(listeners.length > 0, true, 'nothing is listening for SIGTERM');
      for (const listener of listeners) listener('SIGTERM');
      assert.deepEqual(await running, { success: false, error: 'fake-cli exited with SIGTERM' });
      assert.equal(process.listeners('SIGTERM').length, 0, 'the listener is removed once it exits');
    },
  );

  it('fails with the exit code when the CLI fails', async () => {
    const root = projectWith('./bin/cli.cjs', 'process.exit(3);');
    assert.deepEqual(await spawnBin('fake-cli', [], context(root)), {
      success: false,
      error: 'fake-cli exited with code 3',
    });
  });

  it('says which package is missing, and where it looked from', () => {
    assert.throws(
      () => resolveBin('not-installed', projectWith('./bin/cli.cjs', '')),
      /not-installed is not installed, looking from/,
    );
  });

  it('refuses to run outside a project target', async () => {
    const root = projectWith('./bin/cli.cjs', '');
    await assert.rejects(
      spawnBin('fake-cli', [], { ...context(root), target: undefined }),
      /project target/,
    );
  });
});

describe('typecheck', () => {
  /**
   * A project with a fake `ngc` and a Metro config, each recording that it ran, in order, to
   * `ran.log` in the project.
   */
  function typecheckProject(config: string, ngc: string) {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ng-native-builder-')));
    const cli = path.join(root, 'node_modules', '@angular', 'compiler-cli');
    mkdirSync(path.join(cli, 'bundles'), { recursive: true });
    writeFileSync(
      path.join(cli, 'package.json'),
      JSON.stringify({ name: '@angular/compiler-cli', bin: { ngc: './bundles/ngc.js' } }),
    );
    const record = (name: string) =>
      `require('node:fs').appendFileSync('ran.log', ${JSON.stringify(name)} + ' ' + process.argv.slice(2).join(' ') + '\\n');`;
    writeFileSync(path.join(cli, 'bundles', 'ngc.js'), record('ngc') + ngc);
    writeFileSync(path.join(root, 'metro.config.js'), record('metro.config.js') + config);
    return root;
  }
  const ran = (root: string) =>
    existsSync(path.join(root, 'ran.log'))
      ? readFileSync(path.join(root, 'ran.log'), 'utf8')
          .trim()
          .split('\n')
          .map((line) => line.trim())
      : [];

  it("loads the Metro config, so a Tailwind sheet main.ts imports exists, then runs ngc on the project's tsconfig", async () => {
    const root = typecheckProject('', '');
    const ctx = context(root);
    assert.deepEqual(await typecheck.runTypecheck(ctx), { success: true });
    assert.deepEqual(ran(root), ['metro.config.js', 'ngc -p tsconfig.json --noEmit']);
    assert.match(ctx.logged[0]!, /^node metro\.config\.js {2}\(in /);
    assert.match(ctx.logged[1]!, /^ngc -p tsconfig\.json --noEmit {2}\(in /);
  });

  it('runs ngc alone in a project with no Metro config', async () => {
    const root = typecheckProject('', '');
    rmSync(path.join(root, 'metro.config.js'));
    assert.deepEqual(await typecheck.runTypecheck(context(root)), { success: true });
    assert.deepEqual(ran(root), ['ngc -p tsconfig.json --noEmit']);
  });

  it('fails when ngc finds an error', async () => {
    const root = typecheckProject('', 'process.exit(2);');
    assert.deepEqual(await typecheck.runTypecheck(context(root)), {
      success: false,
      error: 'ngc exited with code 2',
    });
  });

  it('stops at a Metro config that fails, before ngc', async () => {
    const root = typecheckProject('process.exit(1);', '');
    const result = await typecheck.runTypecheck(context(root));
    assert.equal(result.success, false);
    assert.deepEqual(ran(root), ['metro.config.js']);
  });
});
