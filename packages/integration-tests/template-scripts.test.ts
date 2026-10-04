/**
 * `create-expo-app` ends by suggesting `npm run android`, `npm run ios` and `npm run web`, whatever
 * the template defines. The template targets iOS and Android, so its `web` script says so and
 * fails, instead of npm reporting a missing script.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const template = fileURLToPath(new URL('../../template/', import.meta.url));
const { scripts } = JSON.parse(readFileSync(`${template}package.json`, 'utf8')) as {
  scripts: Record<string, string>;
};

describe('template scripts', () => {
  it('defines every script create-expo-app suggests', () => {
    for (const name of ['android', 'ios', 'web']) assert.ok(scripts[name], `no "${name}" script`);
  });

  it('web points at the native scripts and the web guide, and fails', () => {
    const run = spawnSync(scripts['web'] ?? 'exit 0', { shell: true, encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /npm run ios/);
    assert.match(run.stderr, /https:\/\/ng-native\.com\/packages\/web#beside-a-native-app/);
  });
});
