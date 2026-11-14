/**
 * `Shell`: urls, files and folders handed to the OS on macOS (NSWorkspace, through the
 * `NgNativeShell` module). Absent elsewhere, where every call resolves false.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Shell, type NativeShell } from '@ng-native/device';
import { cleanup, injectService } from '@ng-native/testing';

afterEach(cleanup);

function fake() {
  const calls: string[] = [];
  const host: NativeShell = {
    openExternal: async (url) => (calls.push(`external ${url}`), true),
    openPath: async (path) => (calls.push(`path ${path}`), true),
    showItemInFolder: async (path) => (calls.push(`reveal ${path}`), true),
  };
  const shell = injectService(Shell, { providers: [{ provide: Shell.SOURCE, useValue: host }] });
  return { shell, calls };
}

describe('Shell', () => {
  it('hands urls, files and folders to the host', async () => {
    const { shell, calls } = fake();
    assert.equal(shell.available(), true);
    assert.equal(await shell.openExternal('https://ng-native.com'), true);
    assert.equal(await shell.openExternal('mailto:me@example.com'), true);
    assert.equal(await shell.openPath('/Users/me/notes.md'), true);
    assert.equal(await shell.showItemInFolder('/Users/me/notes.md'), true);
    assert.deepEqual(calls, [
      'external https://ng-native.com',
      'external mailto:me@example.com',
      'path /Users/me/notes.md',
      'reveal /Users/me/notes.md',
    ]);
  });

  it('refuses a url that runs or embeds content, a file url and one that does not parse', async () => {
    const { shell, calls } = fake();
    for (const url of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<script>',
      'file:///Applications/Calculator.app',
      'not a url',
      '',
    ]) {
      assert.equal(await shell.openExternal(url), false, url);
    }
    assert.deepEqual(calls, []);
  });

  it('refuses a path that is relative or walks out of where it says', async () => {
    const { shell, calls } = fake();
    for (const path of ['notes.md', '/Users/me/../../etc/passwd', '/a/./b', '/a//b', '/a\0b']) {
      assert.equal(await shell.openPath(path), false, path);
      assert.equal(await shell.showItemInFolder(path), false, path);
    }
    assert.deepEqual(calls, []);
  });

  it('is absent without the module: every call resolves false', async () => {
    const shell = injectService(Shell);
    assert.equal(shell.available(), false);
    assert.equal(await shell.openExternal('https://ng-native.com'), false);
    assert.equal(await shell.openPath('/tmp/x'), false);
    assert.equal(await shell.showItemInFolder('/tmp/x'), false);
  });
});
