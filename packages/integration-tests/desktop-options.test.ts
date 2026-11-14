/**
 * The `@ng-native/desktop` plugin options in app.json: document types, declared capabilities and
 * the deny-list, checked before a build so a mistake reads as an error naming where it is, not
 * as a capability silently missing at runtime. Importable in Node from
 * `@ng-native/device/desktop-options`, with no Angular.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import {
  desktopOptionProblems,
  pathAllowed,
  pathProblem,
  validateDesktopOptions,
} from '@ng-native/device';

const require = createRequire(import.meta.url);

const VALID = {
  documentTypes: [
    {
      name: 'Markdown',
      extensions: ['md', 'markdown'],
      role: 'editor',
      utis: ['net.daringfireball.markdown'],
    },
  ],
  capabilities: {
    spawn: [
      { program: 'git', args: ['status', '--porcelain'] },
      { program: '/usr/bin/open', args: ['-R', '{file:/.+}'] },
    ],
    env: ['HOME', 'LANG'],
    paths: [{ path: '~/Projects', access: 'readwrite' }, { path: '/Volumes/Media' }],
  },
  deny: ['react-native-some-library', '@scope/native-thing'],
};

describe('the desktop plugin options', () => {
  it('accepts a full, valid set, and none at all', () => {
    assert.deepEqual(desktopOptionProblems(VALID), []);
    assert.deepEqual(desktopOptionProblems(undefined), []);
    assert.deepEqual(desktopOptionProblems({}), []);
    assert.equal(validateDesktopOptions(VALID), VALID);
  });

  it('names where each problem is', () => {
    const problems = desktopOptionProblems({
      documentTypes: [{ name: '', extensions: ['.md'], role: 'owner' }],
      capabilities: {
        spawn: [
          { program: '/bin/sh', args: ['-c', '{cmd:.*}'] },
          { program: 'tool', args: ['{x:[}'] },
        ],
        env: ['HOME', 'NOT-A-NAME'],
        paths: [{ path: 'relative/dir' }, { path: '~/x/../..', access: 'write' }],
      },
      deny: ['Not A Package'],
    });
    const where = problems.map((problem) => problem.split(':')[0]);
    assert.deepEqual(where, [
      'documentTypes[0].name',
      'documentTypes[0].extensions[0]',
      'documentTypes[0].role',
      'capabilities.spawn[0]',
      'capabilities.spawn[1]',
      'capabilities.env[1]',
      'capabilities.paths[0].path',
      'capabilities.paths[1].path',
      'capabilities.paths[1].access',
      'deny[0]',
    ]);
  });

  it('reports a key it does not know, so a misspelling is not a capability missing', () => {
    assert.deepEqual(desktopOptionProblems({ capabilites: {} }), [
      'capabilites: is not an option (expected one of documentTypes, capabilities, deny)',
    ]);
    assert.match(
      desktopOptionProblems({ capabilities: { spawns: [] } })[0]!,
      /^capabilities.spawns/,
    );
    assert.match(
      desktopOptionProblems({ capabilities: { spawn: [{ program: 'git', env: {} }] } })[0]!,
      /^capabilities.spawn\[0\].env/,
    );
  });

  it('keeps permissions out: the Expo keys declare them', () => {
    assert.match(desktopOptionProblems({ permissions: ['camera'] })[0]!, /^permissions: is not/);
  });

  it('refuses a type that is not what it should be', () => {
    assert.deepEqual(desktopOptionProblems('yes'), ['options must be an object']);
    assert.match(desktopOptionProblems({ deny: 'x' })[0]!, /deny: must be a list/);
    assert.match(
      desktopOptionProblems({ capabilities: [] })[0]!,
      /capabilities: must be an object/,
    );
    assert.match(
      desktopOptionProblems({ documentTypes: [{ name: 'X', extensions: [] }] })[0]!,
      /at least one extension/,
    );
  });

  it('throws one error listing every problem', () => {
    assert.throws(
      () => validateDesktopOptions({ deny: [1], capabilities: { env: [''] } }),
      (error: Error) =>
        error.message.includes('capabilities.env[0]') && error.message.includes('deny[0]'),
    );
  });

  it('is importable in Node with no Angular, for the config plugin', () => {
    const manifest = JSON.parse(
      readFileSync(require.resolve('@ng-native/device/package.json'), 'utf8'),
    ) as { exports: Record<string, string>; publishConfig: { exports: Record<string, unknown> } };
    assert.equal(manifest.exports['./desktop-options'], './src/desktop-options.ts');
    assert.ok(manifest.publishConfig.exports['./desktop-options']);
    const source = readFileSync(
      require
        .resolve('@ng-native/device/package.json')
        .replace('package.json', 'src/desktop-options.ts'),
      'utf8',
    );
    const spawn = readFileSync(
      require
        .resolve('@ng-native/device/package.json')
        .replace('package.json', 'src/spawn-rules.ts'),
      'utf8',
    );
    for (const file of [source, spawn]) {
      const imports = [...file.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
      assert.ok(
        imports.every((from) => from!.startsWith('./')),
        imports.join(', '),
      );
    }
  });
});

describe('a declared path', () => {
  it('is absolute or under the home folder, normalized, and not the whole disk or home', () => {
    assert.equal(pathProblem('/Volumes/Media'), null);
    assert.equal(pathProblem('~/Projects'), null);
    assert.equal(pathProblem('~/Projects/'), null);
    assert.match(pathProblem('Projects')!, /absolute/);
    assert.match(pathProblem('~user/x')!, /absolute/);
    assert.match(pathProblem('/')!, /whole disk/);
    assert.match(pathProblem('~/')!, /whole home/);
    assert.match(pathProblem('~/a/../..')!, /normalized/);
    assert.match(pathProblem('/a/./b')!, /normalized/);
    assert.match(pathProblem('/a//b')!, /normalized/);
    assert.ok(pathProblem('/a\0b'));
  });

  it('allows a path inside it, by whole segments, with the access declared', () => {
    const declared = [
      { path: '~/Projects', access: 'readwrite' as const },
      { path: '/Volumes/Media' },
    ];
    const home = '/Users/me';
    assert.ok(pathAllowed(declared, '/Users/me/Projects', home, 'readwrite'));
    assert.ok(pathAllowed(declared, '/Users/me/Projects/app/src/main.ts', home, 'readwrite'));
    assert.ok(pathAllowed(declared, '/Volumes/Media/film.mov', home));
    assert.ok(!pathAllowed(declared, '/Volumes/Media/film.mov', home, 'readwrite'), 'read only');
    assert.ok(!pathAllowed(declared, '/Users/me/ProjectsSecret', home), 'a prefix of a segment');
    assert.ok(!pathAllowed(declared, '/Users/me/Projects/../.ssh/id_rsa', home), 'walks out');
    assert.ok(!pathAllowed(declared, '~/Projects/x', home), 'unexpanded');
    assert.ok(!pathAllowed(declared, '/Users/me', home));
    assert.ok(!pathAllowed([], '/Users/me/Projects', home));
  });
});
