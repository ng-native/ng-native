/**
 * The generated app is the template's app: in a Turborepo workspace no file needs changing.
 *
 * `template/` is what this project verifies before every release, by publishing it and bundling an
 * app made from it. A file here that differs from the template's is an app nobody has verified.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const native = require('./native-app.cjs');

const template = path.resolve(import.meta.dirname, '../../template');
const manifest = JSON.parse(readFileSync(path.join(template, 'package.json'), 'utf8'));
const templateFile = (file: string) => readFileSync(path.join(template, file), 'utf8');

describe('the generated app', () => {
  for (const file of [...native.SOURCE_FILES, 'AGENTS.md']) {
    it(`copies the template's ${file} as it is`, () => {
      assert.equal(native.sourceFile(file), templateFile(file));
    });
  }

  it("gives the app the template's AGENTS.md, with its own commands in place of npm's", () => {
    const agents = native.agentsFile('COMMANDS');
    const theirs = templateFile('AGENTS.md');
    const around = (text: string) => [
      text.slice(0, text.indexOf('## Commands')),
      text.slice(text.indexOf('## Rules')),
    ];
    assert.deepEqual(around(agents), around(theirs));
    assert.match(agents, /## Commands\n\nCOMMANDS\n\n## Rules/);
  });

  it("runs the template's start, ios, android and test scripts, and dev and build for turbo", () => {
    const scripts = native.scripts(native.DEFAULT_PORT, false);
    for (const name of ['start', 'ios', 'android', 'test']) {
      assert.equal(scripts[name], manifest.scripts[name], name);
    }
    assert.equal(scripts.dev, 'expo start');
    assert.equal(scripts.build, 'expo export --output-dir dist');
    assert.equal(scripts.lint, undefined);
  });

  it("typechecks as the template does, with the app's own copy of each @ng-native package", () => {
    const { typecheck } = native.scripts(native.DEFAULT_PORT, false);
    assert.equal(
      typecheck,
      manifest.scripts.typecheck.replace('tsconfig.json', 'tsconfig.typecheck.json'),
    );
    assert.equal(native.typecheckTsconfig().extends, './tsconfig.json');
  });

  it('starts Metro on its own port everywhere it starts, once the default is taken', () => {
    const scripts = native.scripts(8082, true);
    for (const name of ['dev', 'start', 'ios', 'android']) {
      assert.match(scripts[name], / --port 8082$/, name);
    }
    assert.equal(scripts.lint, 'eslint .');
  });

  it("caches what the build writes, and hashes the .env files the template's .gitignore ignores", () => {
    assert.match(templateFile('gitignore'), /^\.env\*\.local$/m);
    assert.deepEqual(native.TURBO_JSON.tasks.build, {
      dependsOn: ['^build'],
      inputs: ['$TURBO_DEFAULT$', '.env*'],
      outputs: ['dist/**'],
    });
    assert.match(native.scripts(native.DEFAULT_PORT, false).build, /--output-dir dist$/);
    assert.deepEqual(native.TURBO_JSON.extends, ['//']);
  });

  it('caches no typecheck output, which an app without Tailwind never writes', () => {
    // Turborepo warns "no output files found" on every run of a task whose outputs match nothing,
    // and the Tailwind sheet in .angular-native/ is there only once Tailwind is added.
    assert.deepEqual(native.TURBO_JSON.tasks.typecheck, { dependsOn: ['^typecheck'] });
  });

  it("reruns each task that compiles the libraries' source when a library changes", () => {
    // Turborepo hashes a workspace dependency into a task only through a `^` dependency, and a
    // workspace's own turbo.json may define these without one.
    for (const task of ['build', 'typecheck', 'test']) {
      assert.deepEqual(native.TURBO_JSON.tasks[task].dependsOn, [`^${task}`], task);
    }
  });

  it('finds its own files from where it is installed, as turbo gen bundles it elsewhere', () => {
    assert.equal(native.packageDir(), import.meta.dirname);
  });
});
