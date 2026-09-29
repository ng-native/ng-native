/**
 * What the template tells a new app, checked against the packages it names.
 *
 * `AGENTS.md` is the first thing a coding agent reads in a new app, and it said
 * `provideNativeHttpClient()` came from `@ng-native/platform`, which does not export it. And Expo
 * printed "Using src/app as the root directory for Expo Router." on every start of an app that has
 * no Expo Router, because it guesses a router root from the folder the template's app lives in.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const templatePath = (file: string) =>
  fileURLToPath(new URL(`../../template/${file}`, import.meta.url));
const template = (file: string) => readFileSync(templatePath(file), 'utf8');

describe('the template', () => {
  it('names only functions its packages export, from the entry that exports them', async () => {
    const claims = [
      ...template('AGENTS.md').matchAll(/`([A-Za-z]+)\(\)` from `(@ng-native\/[a-z/-]+)`/g),
    ];
    assert.ok(claims.length > 0, 'AGENTS.md names at least one import');
    for (const [, name, entry] of claims) {
      const exported = (await import(entry!)) as Record<string, unknown>;
      assert.equal(typeof exported[name!], 'function', `${name}() from ${entry}`);
    }
  });

  it('sets the router root Expo would otherwise guess out loud', () => {
    const config = JSON.parse(template('app.json')) as {
      expo: { extra?: { router?: { root?: string } } };
    };
    assert.equal(config.expo.extra?.router?.root, 'src/app');
  });

  it('targets iOS and Android only, with nothing configured for a web build it cannot make', () => {
    const { expo } = JSON.parse(template('app.json')) as {
      expo: { platforms?: string[]; web?: unknown };
    };
    assert.deepEqual(expo.platforms, ['ios', 'android']);
    assert.equal(expo.web, undefined);
    assert.doesNotMatch(template('gitignore'), /web-build/);
    assert.equal(existsSync(templatePath('assets/favicon.png')), false);
  });
});
