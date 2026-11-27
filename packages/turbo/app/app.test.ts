import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { type Files, workspace } from '../test-workspace.ts';

const require = createRequire(import.meta.url);
const { app } = require('./index.cjs');
const native = require('../native-app.cjs');
const { registry } = require('@ng-native/migrate/save-exact.cjs') as {
  registry: { versions: (name: string, cwd: string) => Promise<string[]> };
};

// No test reaches the registry: a lookup that is not stubbed fails, as it does offline.
registry.versions = async () => {
  throw new Error('offline');
};

const json = (files: Files, file: string) => files.readJson(file);

describe('ng-native-app', () => {
  it("writes the template's app, named under the workspace's scope", async () => {
    const files = workspace();
    await app(files, { directory: 'apps/mobile' });
    for (const file of native.SOURCE_FILES) {
      assert.equal(files.read(`apps/mobile/${file}`), native.sourceFile(file), file);
    }
    const manifest = json(files, 'apps/mobile/package.json');
    assert.equal(manifest.name, '@repo/mobile');
    assert.equal(manifest.main, 'src/main.ts');
    assert.deepEqual(manifest.dependencies, native.dependencies);
    assert.deepEqual(manifest.devDependencies, native.devDependencies);
    assert.deepEqual(manifest.scripts, native.scripts(native.DEFAULT_PORT, false));
    const { expo } = json(files, 'apps/mobile/app.json');
    assert.equal(expo.slug, 'mobile');
    assert.equal(expo.ios.bundleIdentifier, 'com.repo.mobile');
    assert.deepEqual(json(files, 'apps/mobile/turbo.json'), native.TURBO_JSON);
    assert.deepEqual(
      json(files, 'apps/mobile/tsconfig.typecheck.json'),
      native.typecheckTsconfig(),
    );
    assert.equal(files.read('apps/mobile/CLAUDE.md'), '@AGENTS.md\n');
  });

  it("ignores what the app builds in its own .gitignore, and Expo's cache once at the root", async () => {
    const files = workspace();
    await app(files, { directory: 'apps/mobile' });
    await app(files, { directory: 'apps/tablet' });
    assert.match(files.read('apps/mobile/.gitignore')!, /^\/android$/m);
    assert.match(files.read('apps/mobile/.gitignore')!, /^\/dist$/m);
    assert.equal(files.read('.gitignore')!.match(/^\.expo\/$/gm)?.length, 1);
  });

  it('gives each later app a Metro port of its own, so turbo run dev runs them together', async () => {
    const files = workspace();
    await app(files, { directory: 'apps/mobile' });
    await app(files, { directory: 'apps/tablet' });
    await app(files, { directory: 'apps/watch' });
    assert.equal(json(files, 'apps/mobile/package.json').scripts.dev, 'expo start');
    assert.equal(json(files, 'apps/tablet/package.json').scripts.dev, 'expo start --port 8082');
    assert.equal(
      json(files, 'apps/watch/package.json').scripts.ios,
      'expo start --ios --port 8083',
    );
  });

  it('counts an Expo app with no expo start script as on the default port', async () => {
    const files = workspace({
      'apps/legacy/package.json': JSON.stringify({ name: 'legacy', scripts: {} }),
      'apps/legacy/app.json': '{}',
    });
    await app(files, { directory: 'apps/mobile' });
    assert.equal(json(files, 'apps/mobile/package.json').scripts.start, 'expo start --port 8082');
  });

  it('reads the port of expo start, not of another command in the same script', async () => {
    const files = workspace({
      'apps/legacy/package.json': JSON.stringify({
        name: 'legacy',
        scripts: { dev: "concurrently 'node server.js --port 3000' 'expo start --port 8081'" },
      }),
      'apps/legacy/app.json': '{}',
      'apps/kiosk/package.json': JSON.stringify({
        name: 'kiosk',
        scripts: { start: 'expo start --port 8082 && node log.js --port 9000' },
      }),
      'apps/kiosk/app.json': '{}',
    });
    await app(files, { directory: 'apps/mobile' });
    assert.equal(json(files, 'apps/mobile/package.json').scripts.start, 'expo start --port 8083');
  });

  it("adds the app's directory to the workspace when no glob covers it", async () => {
    const files = workspace({ 'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n" });
    await app(files, { directory: 'apps/mobile' });
    assert.match(files.read('pnpm-workspace.yaml')!, /- 'apps\/\*'/);

    const npm = workspace({
      'package.json': JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
      'pnpm-workspace.yaml': null,
    });
    await app(npm, { directory: 'apps/mobile' });
    assert.deepEqual(json(npm, 'package.json').workspaces, ['packages/*', 'apps/*']);
  });

  it("names an unscoped workspace's app by its directory, and writes the commands npm runs", async () => {
    const files = workspace({
      'package.json': JSON.stringify({ name: 'root', workspaces: ['apps/*'] }),
      'package-lock.json': '{}',
      'pnpm-workspace.yaml': null,
    });
    await app(files, { directory: 'apps/mobile' });
    assert.equal(json(files, 'apps/mobile/package.json').name, 'mobile');
    const agents = files.read('apps/mobile/AGENTS.md')!;
    assert.match(agents, /^npm run start -w mobile +# Metro/m);
    assert.match(agents, /^npx turbo run test --filter=mobile +# Vitest/m);
  });

  it("takes a scoped root's scope over its packages'", async () => {
    const files = workspace({ 'package.json': JSON.stringify({ name: '@acme/root' }) });
    await app(files, { directory: 'apps/mobile' });
    assert.equal(json(files, 'apps/mobile/package.json').name, '@acme/mobile');
    assert.equal(json(files, 'apps/mobile/app.json').expo.ios.bundleIdentifier, 'com.acme.mobile');
  });

  it('names the app by its directory alone where the packages have more than one scope', async () => {
    const files = workspace({
      'packages/config/package.json': JSON.stringify({ name: '@acme/config' }),
      // Unscoped packages, as create-turbo's apps are, do not count against a shared scope.
      'apps/web/package.json': JSON.stringify({ name: 'web' }),
    });
    await app(files, { directory: 'apps/mobile' });
    assert.equal(json(files, 'apps/mobile/package.json').name, 'mobile');
    const shared = workspace({ 'apps/web/package.json': JSON.stringify({ name: 'web' }) });
    await app(shared, { directory: 'apps/mobile' });
    assert.equal(json(shared, 'apps/mobile/package.json').name, '@repo/mobile');
  });

  it('adds ESLint, its config and a lint script with eslint', async () => {
    const files = workspace();
    await app(files, { directory: 'apps/mobile', linter: 'eslint' });
    const manifest = json(files, 'apps/mobile/package.json');
    assert.equal(manifest.scripts.lint, 'eslint .');
    assert.equal(manifest.devDependencies.eslint, native.lintDevDependencies.eslint);
    assert.equal(files.read('apps/mobile/eslint.config.mjs'), native.ESLINT_CONFIG);
    assert.match(files.read('apps/mobile/AGENTS.md')!, /turbo run lint --filter=@repo\/mobile/);
  });

  it("takes the root's range of a package where every version it allows works", async () => {
    const files = workspace({
      'package.json': JSON.stringify({
        name: '@acme/root',
        devDependencies: { vitest: '^4.1.0', typescript: '^5.0.0' },
      }),
    });
    await app(files, { directory: 'apps/mobile' });
    const { devDependencies } = json(files, 'apps/mobile/package.json');
    assert.equal(devDependencies.vitest, '^4.1.0');
    assert.equal(devDependencies.typescript, native.devDependencies.typescript);
  });

  it('saves exact versions where the workspace does', async () => {
    const files = workspace({
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\nsaveExact: true\n",
    });
    await app(files, { directory: 'apps/mobile' });
    const { dependencies } = json(files, 'apps/mobile/package.json');
    // The registry is out of reach, so each range resolves to its floor.
    assert.equal(dependencies.expo, '58.0.16');
    assert.equal(dependencies['@angular/core'], '22.0.0');
  });

  it('refuses a directory that already has a package, or is outside the workspace', async () => {
    const files = workspace({ 'apps/mobile/package.json': '{}' });
    await assert.rejects(app(files, { directory: 'apps/mobile' }), /already has a package\.json/);
    await assert.rejects(app(files, { directory: '../outside' }), /not a directory inside/);
  });

  it('makes a bundle identifier iOS and Android take from any directory name', async () => {
    const files = workspace();
    await app(files, { directory: 'apps/my_app' });
    await app(files, { directory: 'apps/2nd' });
    assert.equal(json(files, 'apps/my_app/app.json').expo.ios.bundleIdentifier, 'com.repo.myapp');
    for (const dir of ['my_app', '2nd']) {
      const { ios, android } = json(files, `apps/${dir}/app.json`).expo;
      assert.equal(native.bundleIdentifierProblem(ios.bundleIdentifier), undefined, dir);
      assert.equal(android.package, ios.bundleIdentifier);
    }
  });

  it('refuses a directory the workspace excludes, or a name npm refuses, writing nothing', async () => {
    const files = workspace({
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - '!apps/private-*'\n",
    });
    await assert.rejects(
      app(files, { directory: 'apps/private-mobile' }),
      /excludes apps\/private-mobile/,
    );
    await assert.rejects(app(files, { directory: 'apps/Mobile' }), /cannot name a package/);
    assert.deepEqual(files.children('apps'), []);
  });

  it('reads a flow list of packages, and asks for one it would have to rewrite by hand', async () => {
    const covered = workspace({ 'pnpm-workspace.yaml': "packages: ['apps/*', 'packages/*']\n" });
    await app(covered, { directory: 'apps/mobile' });
    assert.equal(covered.read('pnpm-workspace.yaml'), "packages: ['apps/*', 'packages/*']\n");
    const other = workspace({ 'pnpm-workspace.yaml': "packages: ['packages/*']\n" });
    await assert.rejects(app(other, { directory: 'apps/mobile' }), /on one line\. Add 'apps\/\*'/);
  });

  it("starts the root's workspaces list when it has none", async () => {
    const files = workspace({
      'package.json': JSON.stringify({ name: 'root', packageManager: 'npm@10.0.0' }),
      'pnpm-workspace.yaml': null,
    });
    await app(files, { directory: 'apps/mobile' });
    assert.deepEqual(json(files, 'package.json').workspaces, ['apps/*']);
  });

  it('tells the reader how to start it', async () => {
    const message = await app(workspace(), { directory: 'apps/mobile' });
    assert.match(message, /pnpm install, then pnpm --filter @repo\/mobile start/);
  });
});
