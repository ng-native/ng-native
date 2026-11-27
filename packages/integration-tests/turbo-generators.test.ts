/**
 * `@ng-native/turbo` in a Turborepo workspace, through Turborepo's own `turbo gen`: `init`, then
 * an app, a library and a component in it, each from the generator's prompts as `--args` fills
 * them. The app takes the library, and what was generated is then checked as a user runs it: the
 * library's tests and typecheck, the app's typecheck, the native modules check, the bundle
 * `expo export` writes, and what `turbo run` would run and cache.
 *
 * The workspace's packages link this repository's installs, as pnpm links its store, so what is
 * checked is the generators and what they write, not npm.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { stripVTControlCharacters } from 'node:util';

const repo = path.resolve(import.meta.dirname, '../..');
const template = path.join(repo, 'template');
const require = createRequire(import.meta.url);
const packageDir = (name: string) => path.dirname(require.resolve(`${name}/package.json`));

const turboGen = path.join(packageDir('@turbo/gen'), 'dist/cli.js');
const turbo = path.join(packageDir('turbo'), 'bin/turbo');
const cli = path.join(repo, 'packages/turbo/cli.cjs');
const quiet = { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1', TURBO_TELEMETRY_DISABLED: '1' };

/** Links each of `names` into `dir`/node_modules from the template's install. */
function link(dir: string, names: Iterable<string>): void {
  for (const name of names) {
    const target = path.join(dir, 'node_modules', name);
    mkdirSync(path.dirname(target), { recursive: true });
    symlinkSync(path.join(template, 'node_modules', name), target);
  }
}

/** Every package the template has installed, scoped ones by their full name. */
function templatePackages(): string[] {
  const modules = path.join(template, 'node_modules');
  return readdirSync(modules)
    .filter((name) => !name.startsWith('.'))
    .flatMap((name) =>
      name.startsWith('@')
        ? readdirSync(path.join(modules, name)).map((scoped) => `${name}/${scoped}`)
        : [name],
    );
}

describe('@ng-native/turbo, through turbo gen', () => {
  let root = '';
  const at = (...parts: string[]) => path.join(root, ...parts);
  const read = (file: string) => readFileSync(at(file), 'utf8');
  const json = (file: string) => JSON.parse(read(file));
  // Plain text whatever the terminal: CI sets FORCE_COLOR, and Vitest then colours its summary
  // between "Tests" and "2 passed".
  const run = (command: string, args: string[], cwd = root) =>
    stripVTControlCharacters(
      execFileSync(command, args, { cwd, stdio: 'pipe', encoding: 'utf8', env: quiet }),
    );
  const gen = (generator: string, ...args: string[]) =>
    run(process.execPath, [turboGen, 'run', generator, '--args', ...args, '--root', root]);
  /** A file of the package `name` as the package at `cwd` resolves it, past its `exports`. */
  const installed = (cwd: string, name: string, file: string) =>
    path.join(path.dirname(require.resolve(`${name}/package.json`, { paths: [cwd] })), file);
  const ngc = (cwd: string, ...args: string[]) =>
    run(
      process.execPath,
      [installed(cwd, '@angular/compiler-cli', 'bundles/src/bin/ngc.js'), ...args],
      cwd,
    );

  /**
   * The workspace `create-turbo` 2.11 writes with pnpm, before its install: an unscoped root, a
   * TypeScript 7 that `@ng-native/migrate` cannot take, two Next.js apps, and the `@repo` packages,
   * a React library at `packages/ui` among them.
   */
  const createTurbo = () => {
    const files: Record<string, unknown> = {
      'package.json': {
        name: 'my-turborepo',
        private: true,
        scripts: {
          build: 'turbo run build',
          dev: 'turbo run dev',
          lint: 'turbo run lint',
          'check-types': 'turbo run check-types',
        },
        devDependencies: { prettier: '3.9.6', turbo: '^2.11.13', typescript: '7.0.2' },
        packageManager: 'pnpm@11.25.0',
        engines: { node: '>=24' },
      },
      'turbo.json': {
        $schema: 'https://turborepo.dev/schema.json',
        ui: 'tui',
        tasks: {
          build: {
            dependsOn: ['^build'],
            inputs: ['$TURBO_DEFAULT$', '.env*'],
            outputs: ['.next/**', '!.next/cache/**', '!.next/dev/**'],
          },
          lint: { dependsOn: ['^lint'] },
          'check-types': { dependsOn: ['^check-types'] },
          dev: { cache: false, persistent: true },
        },
      },
      'apps/web/package.json': {
        name: 'web',
        private: true,
        scripts: { dev: 'next dev --port 3000' },
      },
      'apps/docs/package.json': {
        name: 'docs',
        private: true,
        scripts: { dev: 'next dev --port 3001' },
      },
      'packages/ui/package.json': {
        name: '@repo/ui',
        private: true,
        exports: { './*': './src/*.tsx' },
        dependencies: { react: '19.2.8', 'react-dom': '19.2.8' },
      },
      'packages/eslint-config/package.json': { name: '@repo/eslint-config', private: true },
      'packages/typescript-config/package.json': { name: '@repo/typescript-config', private: true },
    };
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(at(file)), { recursive: true });
      writeFileSync(at(file), JSON.stringify(content, null, 2) + '\n');
    }
    writeFileSync(at('pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n  - "packages/*"\n');
    writeFileSync(at('.gitignore'), 'node_modules\n.turbo\n.env*.local\n');
  };

  // Real, because Metro watches the project under the path it is given and macOS links the temp
  // directory from somewhere else.
  before(() => {
    root = path.join(
      mkdtempSync(path.join(realpathSync(tmpdir()), 'turbo-generators-')),
      'my-turborepo',
    );
    mkdirSync(root);
    createTurbo();
    run(process.execPath, [cli, 'init']);
    // What the install after `init` links at the root: the package the config imports.
    mkdirSync(at('node_modules/@ng-native'), { recursive: true });
    symlinkSync(path.join(repo, 'packages/turbo'), at('node_modules/@ng-native/turbo'));

    gen('ng-native-app', 'apps/mobile', 'none');
    gen('ng-native-library', 'packages/native-ui');
    gen('ng-native-component', 'profile-card', '@repo/native-ui');

    // The app takes the library, as the library generator's message says.
    const manifest = json('apps/mobile/package.json');
    manifest.dependencies['@repo/native-ui'] = 'workspace:*';
    writeFileSync(at('apps/mobile/package.json'), JSON.stringify(manifest, null, 2));
    const appTs = at('apps/mobile/src/app/app.ts');
    const source = readFileSync(appTs, 'utf8')
      .replace(/^(import .*\n)/, "$1import { NativeUi, ProfileCard } from '@repo/native-ui';\n")
      .replace('imports: [', 'imports: [NativeUi, ProfileCard, ')
      .replace(
        /^(\s*)(<text class="title">.*\n)/m,
        '$1$2$1<repo-native-ui />\n$1<repo-profile-card />\n',
      );
    assert.notEqual(source, readFileSync(appTs, 'utf8'));
    writeFileSync(appTs, source);

    const library = json('packages/native-ui/package.json');
    link(at('packages/native-ui'), Object.keys(library.devDependencies));
    link(at('apps/mobile'), templatePackages());
    mkdirSync(at('apps/mobile/node_modules/@repo'));
    symlinkSync(at('packages/native-ui'), at('apps/mobile/node_modules/@repo/native-ui'));
  });
  after(() => rmSync(path.dirname(root), { recursive: true, force: true }));

  it("names what it generates under the scope create-turbo's packages share", () => {
    assert.equal(json('apps/mobile/package.json').name, '@repo/mobile');
    assert.equal(json('packages/native-ui/package.json').name, '@repo/native-ui');
    assert.equal(json('apps/mobile/app.json').expo.ios.bundleIdentifier, 'com.repo.mobile');
    // create-turbo's own library is left as it was.
    assert.equal(json('packages/ui/package.json').name, '@repo/ui');
  });

  it("declines esbuild's install script, which pnpm 11 refuses to install without deciding", () => {
    assert.equal(
      read('pnpm-workspace.yaml'),
      'packages:\n  - "apps/*"\n  - "packages/*"\n\nallowBuilds:\n  esbuild: false\n',
    );
  });

  it("generates the library's component into it, exported from its index", () => {
    assert.equal(
      read('packages/native-ui/src/index.ts'),
      "export { NativeUi } from './lib/native-ui.ts';\n" +
        "export { ProfileCard } from './lib/profile-card/profile-card.ts';\n",
    );
  });

  it("runs the library's tests on the fake Fabric, and checks its templates", () => {
    const vitest = installed(at('packages/native-ui'), 'vitest', 'vitest.mjs');
    const out = run(process.execPath, [vitest, 'run'], at('packages/native-ui'));
    assert.match(out, /Tests\s+2 passed/);
    ngc(at('packages/native-ui'), '-p', 'tsconfig.json');
  });

  it("typechecks the app, its templates and the library's it uses", () => {
    ngc(at('apps/mobile'), '-p', 'tsconfig.typecheck.json', '--noEmit');
  });

  it('finds no native module the app lacks, since the library uses none', () => {
    assert.match(
      run(process.execPath, [cli, 'sync', '--check'], at('apps/mobile')),
      /Every app lists/,
    );
  });

  it("bundles the app with the library's components compiled ahead of time, and one Angular", () => {
    const out = at('apps/mobile/dist');
    const expoCli = path.join(
      path.dirname(require.resolve('expo/package.json', { paths: [template] })),
      'bin/cli',
    );
    run(
      process.execPath,
      [expoCli, 'export', '--platform', 'ios', '--output-dir', out, '--no-bytecode'],
      at('apps/mobile'),
    );
    const dir = path.join(out, '_expo/static/js/ios');
    const [name] = readdirSync(dir).filter((file) => file.endsWith('.js'));
    assert.ok(name, `no ios bundle in ${dir}`);
    const bundle = readFileSync(path.join(dir, name), 'utf8');
    // Tested rather than matched, so a failure names the pattern and not the whole bundle.
    for (const pattern of [
      // Each component, compiled.
      /selectors:\[\["repo-native-ui"\]\]/,
      /selectors:\[\["repo-profile-card"\]\]/,
      /"profile-card works"/,
      // And placed in the app's template, as a chained or a separate element call.
      /\(\d+,"repo-native-ui"\)/,
      /\(\d+,"repo-profile-card"\)/,
    ]) {
      assert.ok(pattern.test(bundle), `the bundle has nothing matching ${pattern}`);
    }
    // A message in @angular/core alone, so a second copy is a second match.
    assert.equal(bundle.split('is not an Angular component').length - 1, 1);
  });

  it('gives turbo run the tasks the app runs, caching its bundle and hashing its .env files', () => {
    run('git', ['init', '-q']);
    writeFileSync(at('apps/mobile/.env.local'), 'EXPO_PUBLIC_API=a\n');
    const dry = () => {
      const plan = JSON.parse(
        run(turbo, ['run', 'build', 'typecheck', 'test', '--filter=@repo/mobile', '--dry=json']),
      );
      // The app's alone: the plan has the library's `build` too, which the app's depends on.
      return Object.fromEntries(
        plan.tasks
          .filter((task: { package: string }) => task.package === '@repo/mobile')
          .map((task: { task: string }) => [task.task, task]),
      ) as Record<
        string,
        {
          hash: string;
          command: string;
          inputs: object;
          resolvedTaskDefinition: { outputs: string[] };
        }
      >;
    };
    const first = dry();
    assert.equal(first.build.command, 'expo export --output-dir dist');
    assert.deepEqual(first.build.resolvedTaskDefinition.outputs, ['dist/**']);
    assert.ok('.env.local' in first.build.inputs, 'the ignored .env.local is not hashed');
    assert.deepEqual(first.typecheck.resolvedTaskDefinition.outputs, []);
    assert.equal(first.test.command, 'vitest run --project node');
    // A changed value Expo would inline into the bundle is a different build.
    writeFileSync(at('apps/mobile/.env.local'), 'EXPO_PUBLIC_API=b\n');
    const second = dry();
    assert.notEqual(second.build.hash, first.build.hash);
    // And an edit to the library, which Metro, ngc and Vitest compile with the app, reruns each.
    writeFileSync(
      at('packages/native-ui/src/lib/native-ui.ts'),
      read('packages/native-ui/src/lib/native-ui.ts').replace(
        'native-ui works',
        'native-ui still works',
      ),
    );
    const third = dry();
    for (const task of ['build', 'typecheck', 'test'] as const) {
      assert.notEqual(third[task].hash, second[task].hash, `${task} replays after a library edit`);
    }
  });
});
