/**
 * native/scripts/launch-cell.sh, the nightly check that the GTK host built on el9 runs on each
 * distribution: what it refuses before it installs anything, and that it installs what a .deb of
 * the app depends on, so the nightly launch is the one a person installing the .deb gets.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEB_DEPENDS } from './package-linux.mjs';

const script = fileURLToPath(new URL('../native/scripts/launch-cell.sh', import.meta.url));

const run = (...args: string[]) => spawnSync('bash', [script, ...args], { encoding: 'utf8' });

describe('launch-cell.sh', () => {
  it('needs at least one cell', () => {
    const result = run('/h', '/b.js', '/out');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /name at least one cell/);
  });

  it('refuses a cell it does not know before it installs anything', () => {
    const result = run('/h', '/b.js', '/out', 'x11', 'wayland2');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no cell named wayland2/);
  });

  it('installs every package a .deb of the app depends on, on Debian and Ubuntu', () => {
    const text = readFileSync(script, 'utf8');
    const debian = /ubuntu \| debian\)[\s\S]*?packages=\(([\s\S]*?)\)/.exec(text)?.[1];
    assert.ok(debian, 'the Debian package list');
    const listed = new Set(debian.split(/\s+/).filter(Boolean));
    for (const dependency of DEB_DEPENDS) {
      const name = dependency.split(' ')[0]!;
      assert.ok(listed.has(name), `${name} is installed`);
    }
  });
});
