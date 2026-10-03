/**
 * The generated app is the template's app, apart from the three files Nx needs changed.
 *
 * `template/` is what this project verifies before every release, by publishing it and bundling an
 * app made from it. A file here that differs from the template's, or a version that does, is an
 * app nobody has verified.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const native = require('./native-app.cjs');

const template = path.resolve(import.meta.dirname, '../../template');
const manifest = JSON.parse(readFileSync(path.join(template, 'package.json'), 'utf8'));
const templateFile = (file: string) => readFileSync(path.join(template, file), 'utf8');

describe('the generated app', () => {
  for (const file of native.SOURCE_FILES) {
    it(`copies the template's ${file} as it is`, () => {
      assert.equal(native.sourceFile(file), templateFile(file));
    });
  }

  it("gives the app the template's AGENTS.md, with its own commands in place of npm's", () => {
    const agents = native.agentsFile('COMMANDS');
    const theirs = readFileSync(path.join(template, 'AGENTS.md'), 'utf8');
    assert.equal(native.sourceFile('AGENTS.md'), theirs);
    const around = (text: string) => [
      text.slice(0, text.indexOf('## Commands')),
      text.slice(text.indexOf('## Rules')),
    ];
    assert.deepEqual(around(agents), around(theirs));
    assert.match(agents, /## Commands\n\nCOMMANDS\n\n## Rules/);
  });

  it("keeps the template's vitest.config.mts when there are no path aliases to resolve", () => {
    assert.equal(native.vitestConfig(false), templateFile('vitest.config.mts'));
  });

  it("adds Nx's tsconfig path resolution to it when there are", () => {
    const config = native.vitestConfig(true);
    assert.match(
      config,
      /import \{ nxViteTsPaths \} from '@nx\/vite\/plugins\/nx-tsconfig-paths\.plugin';/,
    );
    assert.match(config, /plugins: \[nxViteTsPaths\(\), ngNative\(\)\],/);
  });

  it("applies the template's Metro preset around withNxMetro, so it can wrap Nx's resolver", () => {
    assert.match(
      native.METRO_CONFIG,
      /module\.exports = withAngularNative\(withNxMetro\(getDefaultConfig\(__dirname\)\)\);/,
    );
    assert.match(
      templateFile('metro.config.js'),
      /withAngularNative\(getDefaultConfig\(__dirname\)\)/,
    );
  });

  it("uses the template's tsconfig when there is no workspace base to extend", () => {
    assert.deepEqual(native.tsconfig(undefined), JSON.parse(templateFile('tsconfig.json')));
  });

  it("extends the workspace base after Expo's, and puts Expo's settings back", () => {
    const config = native.tsconfig('../../tsconfig.base.json');
    assert.deepEqual(config.extends, ['expo/tsconfig.base', '../../tsconfig.base.json']);
    assert.deepEqual(config.compilerOptions.lib, ['DOM', 'ESNext']);
    assert.equal(config.compilerOptions.allowImportingTsExtensions, true);
    assert.equal(config.compilerOptions.noEmit, true);
  });

  it("installs the template's dependencies, at the template's versions", () => {
    for (const field of ['dependencies', 'devDependencies'] as const) {
      assert.deepEqual(Object.keys(native[field]).sort(), Object.keys(manifest[field]).sort());
      for (const [name, range] of Object.entries(manifest[field])) {
        if (range !== 'workspace:*') assert.equal(native[field][name], range, name);
      }
    }
  });

  it("typechecks as the template's script does, building the Tailwind sheet first", () => {
    assert.equal(native.TYPECHECK, manifest.scripts.typecheck);
    assert.equal(native.TYPECHECK, 'node metro.config.js && ngc -p tsconfig.json --noEmit');
  });

  it('maps the entry points of every package that publishes them in dist, and of no other', () => {
    const packages = path.resolve(import.meta.dirname, '..');
    const inDist = readdirSync(packages).filter((name) => {
      const file = path.join(packages, name, 'package.json');
      if (!existsSync(file)) return false;
      const published = JSON.parse(readFileSync(file, 'utf8')).publishConfig?.exports ?? {};
      const entries = Object.entries(published).filter(
        ([key, to]) => key !== '.' && typeof to === 'object' && to !== null && 'types' in to,
      ) as [string, { types: string }][];
      // An entry point published elsewhere, a Vite plugin or the test runner, is not mapped, and
      // resolves as it would with no mapping.
      return entries.some(([key, to]) => to.types === `./dist/${key.slice(2)}.d.ts`);
    });
    assert.deepEqual(inDist.sort(), [...native.WITH_ENTRY_POINTS].sort());
  });

  it("ignores what the template's gitignore does in the app's own directory", () => {
    const ignored = (text: string) =>
      text.split('\n').filter((line: string) => line && !line.startsWith('#'));
    for (const line of ignored(native.GITIGNORE)) {
      assert.ok(ignored(templateFile('gitignore')).includes(line), line);
    }
    assert.ok(ignored(native.GITIGNORE).includes('.angular-native/'));
  });

  it("puts Expo's own ranges of what it depends on at the root", () => {
    const expo = require(require.resolve('expo/package.json', { paths: [template] }));
    for (const name of ['@expo/cli', '@expo/metro', '@babel/runtime']) {
      assert.equal(native.expoCompanions[name], expo.dependencies[name], name);
    }
  });

  it('pins the framework packages to its own version, since they are released together', () => {
    const { version } = require('./package.json');
    assert.equal(native.dependencies['@ng-native/components'], version);
    assert.equal(native.devDependencies['@ng-native/testing'], version);
  });

  it('derives a bundle identifier iOS and Android both accept', () => {
    assert.equal(native.bundleIdentifier('field-notes', '@acme'), 'com.acme.fieldnotes');
    assert.equal(native.bundleIdentifier('mobile', undefined), 'com.mobile');
    // Android refuses a segment that is a Java keyword or starts with a digit.
    assert.equal(native.bundleIdentifier('native', '@ng-native'), 'com.ngnative.appnative');
    assert.equal(native.bundleIdentifier('mobile', '@1password'), 'com.mobile');
    assert.equal(native.bundleIdentifier('Mobile_App', '@new'), 'com.mobileapp');
    for (const id of ['com.acme.fieldnotes', 'com.ngnative.appnative', 'com.mobileapp']) {
      assert.ok(native.isBundleIdentifier(id), id);
    }
  });

  it('refuses a segment that is a Kotlin keyword, which Expo writes into Kotlin packages', () => {
    for (const id of ['com.acme.object', 'com.fun.notes', 'com.acme.when', 'com.val.app']) {
      assert.equal(native.isBundleIdentifier(id), false, id);
      assert.match(native.bundleIdentifierProblem(id), /Kotlin keyword/);
    }
    assert.equal(native.bundleIdentifier('object', '@acme'), 'com.acme.appobject');
    assert.equal(native.bundleIdentifier('notes', '@fun'), 'com.notes');
  });

  it("names app.json for the project without its scope, keeping the template's settings", () => {
    const { expo } = JSON.parse(native.appJson('@org/field-notes'));
    const theirs = JSON.parse(templateFile('app.json')).expo;
    assert.equal(expo.slug, 'field-notes');
    assert.equal(expo.scheme, 'fieldnotes');
    for (const key of ['orientation', 'userInterfaceStyle', 'version', 'platforms', 'extra']) {
      assert.deepEqual(expo[key], theirs[key], key);
    }
  });

  it('names the platforms, so the react-dom Nx installs does not add web to a bare nx export', () => {
    // Expo adds `web` whenever `react-dom` resolves, and @nx/expo's @nx/react dependency puts one at
    // the root. `nx export mobile` then stopped to ask for react-native-web.
    assert.deepEqual(JSON.parse(native.appJson('mobile')).expo.platforms, ['ios', 'android']);
  });
});

describe('conflicts', () => {
  it("says nothing about the workspace's own pins of the framework packages", () => {
    const workspace = { dependencies: { '@ng-native/platform': '0.0.1' } };
    assert.deepEqual(native.conflicts(workspace), []);
  });

  it('says nothing about ranges that can resolve to what the app needs', () => {
    assert.deepEqual(
      native.conflicts({
        dependencies: { '@angular/core': '~22.2.0' },
        devDependencies: { typescript: '~6.0.2' },
      }),
      [],
    );
  });

  it("accepts the Angular and Vitest @nx/angular's workspace pins today", () => {
    const problems = native.conflicts({
      dependencies: { '@angular/core': '22.1.4' },
      devDependencies: { vitest: '~4.1.0' },
    });
    assert.deepEqual(problems, []);
  });

  it("accepts the Vitest range @ng-native/testing's plugin does, and names one older", () => {
    const testing = JSON.parse(
      readFileSync(new URL('../testing/package.json', import.meta.url), 'utf8'),
    );
    assert.equal(native.accepted.vitest, testing.peerDependencies.vitest);
    const [problem] = native.conflicts({ devDependencies: { vitest: '^3.2.0' } });
    assert.match(
      problem,
      /vitest is \^3\.2\.0 here, and Angular Native needs \^4\.0\.8 \|\| \^5\.0\.0/,
    );
  });
});

describe('the app shape both generators share', () => {
  it("is @ng-native/migrate's, which @ng-native/schematics builds its apps from too", () => {
    const shared = require('@ng-native/migrate/native-app.cjs');
    for (const [name, value] of Object.entries(shared)) assert.equal(native[name], value, name);
  });
});

describe('nx migrate', () => {
  const packages = path.resolve(import.meta.dirname, '..');
  const published = readdirSync(packages)
    .map((dir) => path.join(packages, dir, 'package.json'))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8')) as { name: string; private?: boolean })
    .filter((pkg) => !pkg.private)
    .map((pkg) => pkg.name);

  it('moves every published @ng-native package with this one, since they are released together', () => {
    // `nx migrate @ng-native/nx@latest` moved only @ng-native/nx, and the other packages stayed on
    // the old version beside it. Nx moves a package's packageGroup to the version it migrates to.
    // The group names this package too, as @ng-native/schematics' does for ng update, which needs
    // it there; Nx skips a package it is already moving.
    const own = require('./package.json');
    const group = own['nx-migrations'].packageGroup as string[];
    assert.deepEqual([...group].sort(), [...published].sort());
  });
});
