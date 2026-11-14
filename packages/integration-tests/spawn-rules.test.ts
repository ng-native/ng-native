/**
 * The spawn capability rules: which programs a desktop app may run, with which arguments. They
 * guard against bugs and injected content, so most of these are attempts to get past them.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SEARCH_PATH,
  SpawnRuleError,
  compileCapability,
  filterEnvironment,
  matchSpawn,
  programProblem,
  resolveProgram,
  type SpawnCapability,
} from '@ng-native/device';

const compile = (...entries: SpawnCapability[]) => entries.map(compileCapability);
const allows = (entries: SpawnCapability[], program: string, args: string[], pinned = {}) =>
  matchSpawn(compile(...entries), program, args, pinned) !== null;

const GIT_CLONE: SpawnCapability = {
  program: '/usr/bin/git',
  args: ['clone', '{url:https://[^\\s]+}', '{dir:[\\w.-]+}'],
};

describe('a declared program', () => {
  it('is an absolute path or a bare name', () => {
    assert.equal(programProblem('/usr/bin/git'), null);
    assert.equal(programProblem('git'), null);
    assert.equal(programProblem('/opt/homebrew/bin/ffmpeg'), null);
  });

  it('is never a relative path, which would depend on the working directory', () => {
    assert.match(programProblem('./tool')!, /relative/);
    assert.match(programProblem('bin/tool')!, /relative/);
    assert.match(programProblem('..\\tool')!, /relative/);
  });

  it('is a normalized absolute path, with no . or .. to walk out of a folder', () => {
    assert.match(programProblem('/usr/bin/../../bin/sh2')!, /normalized/);
    assert.match(programProblem('/usr/./bin/git')!, /normalized/);
    assert.match(programProblem('/usr//bin/git')!, /normalized/);
    assert.match(programProblem('/usr/bin/')!, /normalized/);
    assert.ok(programProblem('..'));
    assert.ok(programProblem('.'));
  });

  it('is never a shell, or a program that runs its arguments as a command', () => {
    for (const program of [
      'sh',
      '/bin/sh',
      '/bin/bash',
      '/bin/zsh',
      '/opt/homebrew/bin/fish',
      'env',
      '/usr/bin/env',
      'xargs',
      'sudo',
      'osascript',
      'BASH',
      'C:\\Windows\\System32\\cmd.exe',
      'powershell.exe',
      'pwsh',
    ]) {
      assert.ok(programProblem(program), `${program} is refused`);
    }
  });

  it('is never a Windows batch file, which cmd.exe re-parses (BatBadBut)', () => {
    assert.match(programProblem('C:\\tools\\build.bat')!, /batch file/);
    assert.match(programProblem('/Users/me/run.CMD')!, /batch file/);
  });

  it('has no NUL character or surrounding white space', () => {
    assert.ok(programProblem('/usr/bin/git\0/bin/sh'));
    assert.ok(programProblem(' git'));
    assert.ok(programProblem(''));
  });

  it('is refused at compile time, with the reason', () => {
    assert.throws(() => compileCapability({ program: '/bin/sh', args: ['-c', '{cmd:.*}'] }), {
      name: 'SpawnRuleError',
      message: /runs its arguments as a command/,
    });
  });
});

describe('a declared argument list', () => {
  it('rejects a pattern that does not compile', () => {
    assert.throws(() => compileCapability({ program: 'git', args: ['{x:[}'] }), SpawnRuleError);
  });

  it('rejects a pattern that would close the anchoring group and escape it', () => {
    assert.throws(
      () => compileCapability({ program: 'git', args: ['{x:a)|(.*}'] }),
      SpawnRuleError,
    );
  });

  it('rejects a placeholder named twice, and more than one repeated placeholder', () => {
    assert.throws(() => compileCapability({ program: 'git', args: ['{a:x}', '{a:y}'] }), /twice/);
    assert.throws(
      () => compileCapability({ program: 'git', args: ['{a:x}...', '{b:y}...'] }),
      /at most one/,
    );
  });

  it('rejects arguments that are not a list of strings', () => {
    assert.throws(
      () => compileCapability({ program: 'git', args: 'status' as never }),
      SpawnRuleError,
    );
    assert.throws(() => compileCapability({ program: 'git', args: [1 as never] }), SpawnRuleError);
  });

  it('takes text that only looks like a placeholder as a literal', () => {
    const [rule] = compileCapability({ program: 'git', args: ['{not a placeholder}'] }).args;
    assert.equal(rule!.kind, 'literal');
  });
});

describe('matching a call', () => {
  it('allows the declared literal arguments exactly, and nothing else', () => {
    const status = { program: '/usr/bin/git', args: ['status', '--porcelain'] };
    assert.ok(allows([status], '/usr/bin/git', ['status', '--porcelain']));
    assert.ok(!allows([status], '/usr/bin/git', ['status']), 'too few');
    assert.ok(!allows([status], '/usr/bin/git', ['status', '--porcelain', '-z']), 'too many');
    assert.ok(!allows([status], '/usr/bin/git', ['--porcelain', 'status']), 'out of order');
    assert.ok(!allows([status], '/usr/bin/git', ['Status', '--porcelain']), 'case matters');
  });

  it('allows a placeholder to take an argument its whole pattern matches', () => {
    assert.ok(allows([GIT_CLONE], '/usr/bin/git', ['clone', 'https://x.dev/a.git', 'a']));
    const match = matchSpawn(compile(GIT_CLONE), '/usr/bin/git', [
      'clone',
      'https://x.dev/a.git',
      'a',
    ]);
    assert.deepEqual(match?.values, { url: 'https://x.dev/a.git', dir: 'a' });
  });

  it('anchors a placeholder, so part of an argument matching is not enough', () => {
    const branch = { program: 'git', args: ['checkout', '{branch:[a-z]+}'] };
    const pinned = { git: '/usr/bin/git' };
    assert.ok(allows([branch], 'git', ['checkout', 'main'], pinned));
    assert.ok(!allows([branch], 'git', ['checkout', 'main;rm -rf ~'], pinned));
    assert.ok(!allows([branch], 'git', ['checkout', '--upload-pack=touch /tmp/x'], pinned));
    assert.ok(!allows([branch], 'git', ['checkout', 'main\nother'], pinned));
  });

  it('anchors every branch of an alternation', () => {
    const either = { program: '/usr/bin/tool', args: ['{mode:fast|slow}'] };
    assert.ok(allows([either], '/usr/bin/tool', ['slow']));
    assert.ok(!allows([either], '/usr/bin/tool', ['fast; reboot']));
    assert.ok(!allows([either], '/usr/bin/tool', ['x slow']));
  });

  it('never lets a placeholder take an option, unless its pattern starts with -', () => {
    const anything = { program: '/usr/bin/tool', args: ['{value:.*}'] };
    assert.ok(allows([anything], '/usr/bin/tool', ['ok']));
    assert.ok(!allows([anything], '/usr/bin/tool', ['-rf']));
    assert.ok(!allows([anything], '/usr/bin/tool', ['--output=/etc/passwd']));
    const flag = { program: '/usr/bin/tool', args: ['{flag:-v|--verbose}'] };
    assert.ok(allows([flag], '/usr/bin/tool', ['-v']));
    assert.ok(allows([flag], '/usr/bin/tool', ['--verbose']));
    assert.ok(!allows([flag], '/usr/bin/tool', ['--exec=x']));
  });

  it('passes shell metacharacters as plain text, never to a shell', () => {
    // Whether one gets through is the pattern's business: nothing interprets it.
    const name = { program: '/usr/bin/tool', args: ['{name:[\\w.]+}'] };
    for (const value of ['$(reboot)', '`id`', 'a|b', 'a&&b', 'a;b', '$HOME', 'a>b', '*']) {
      assert.ok(!allows([name], '/usr/bin/tool', [value]), value);
    }
  });

  it('refuses an argument with a NUL character, which native would cut short', () => {
    const any = { program: '/usr/bin/tool', args: ['{x:[\\s\\S]*}'] };
    assert.ok(!allows([any], '/usr/bin/tool', ['ok\0--evil']));
    const literal = { program: '/usr/bin/tool', args: ['ok'] };
    assert.ok(!allows([literal], '/usr/bin/tool', ['ok\0']));
  });

  it('matches path traversal only where the pattern lets it', () => {
    const file = { program: '/usr/bin/tool', args: ['{file:[\\w-]+\\.txt}'] };
    assert.ok(allows([file], '/usr/bin/tool', ['notes.txt']));
    assert.ok(!allows([file], '/usr/bin/tool', ['../../etc/passwd.txt']));
    assert.ok(!allows([file], '/usr/bin/tool', ['/etc/x.txt']));
  });

  it('takes zero or more arguments for a repeated placeholder, each by the same rules', () => {
    const add = { program: '/usr/bin/git', args: ['add', '--', '{files:[\\w./]+}...'] };
    assert.ok(allows([add], '/usr/bin/git', ['add', '--']));
    assert.ok(allows([add], '/usr/bin/git', ['add', '--', 'a.ts', 'src/b.ts']));
    assert.deepEqual(matchSpawn(compile(add), '/usr/bin/git', ['add', '--', 'a', 'b'])?.values, {
      files: ['a', 'b'],
    });
    assert.ok(!allows([add], '/usr/bin/git', ['add', '--', 'a', '-f']), 'an option among them');
    assert.ok(!allows([add], '/usr/bin/git', ['add', '--', 'a', 'b c']), 'one failing its pattern');
  });

  it('keeps the literals after a repeated placeholder at the end', () => {
    const convert = { program: '/usr/bin/tool', args: ['{inputs:\\w+}...', '-o', '{out:\\w+}'] };
    assert.deepEqual(matchSpawn(compile(convert), '/usr/bin/tool', ['a', 'b', '-o', 'c'])?.values, {
      inputs: ['a', 'b'],
      out: 'c',
    });
    assert.ok(allows([convert], '/usr/bin/tool', ['-o', 'c']));
    assert.ok(!allows([convert], '/usr/bin/tool', ['a', '-o']));
    assert.ok(!allows([convert], '/usr/bin/tool', ['a', 'b', 'c']));
  });

  it('matches the program as declared, never another with the same name', () => {
    assert.ok(!allows([GIT_CLONE], 'git', ['clone', 'https://x', 'a']), 'not by bare name');
    assert.ok(!allows([GIT_CLONE], '/tmp/git', ['clone', 'https://x', 'a']));
    assert.ok(!allows([GIT_CLONE], '/usr/bin/../bin/git', ['clone', 'https://x', 'a']));
  });

  it('runs a bare name only where it was pinned, by its name or that path', () => {
    const status = { program: 'git', args: ['status'] };
    assert.ok(!allows([status], 'git', ['status']), 'not pinned: absent');
    assert.ok(!allows([status], 'git', ['status'], { git: null }), 'not found at startup');
    const pinned = { git: '/opt/homebrew/bin/git' };
    assert.equal(matchSpawn(compile(status), 'git', ['status'], pinned)?.path, pinned.git);
    assert.ok(allows([status], '/opt/homebrew/bin/git', ['status'], pinned));
    assert.ok(!allows([status], '/usr/bin/git', ['status'], pinned), 'another git');
  });

  it('tries each capability in turn', () => {
    const entries = [
      { program: '/usr/bin/git', args: ['status'] },
      { program: '/usr/bin/git', args: ['log', '{n:-n\\d+}'] },
    ];
    assert.ok(allows(entries, '/usr/bin/git', ['log', '-n5']));
    assert.ok(!allows(entries, '/usr/bin/git', ['log', '-n5; x']));
  });
});

describe('resolving a bare name', () => {
  const at = (...present: string[]) => ({ isExecutable: (path: string) => present.includes(path) });

  it('looks on the system folders, then Homebrew, and never the inherited PATH', () => {
    assert.deepEqual(SEARCH_PATH, [
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ]);
    assert.equal(
      resolveProgram('ffmpeg', at('/opt/homebrew/bin/ffmpeg')),
      '/opt/homebrew/bin/ffmpeg',
    );
    assert.equal(
      resolveProgram('git', at('/usr/local/bin/git', '/usr/bin/git')),
      '/usr/bin/git',
      'the first folder in order wins',
    );
    const previous = process.env['PATH'];
    process.env['PATH'] = '/tmp/evil';
    try {
      assert.equal(resolveProgram('git', at('/tmp/evil/git')), null);
    } finally {
      process.env['PATH'] = previous;
    }
  });

  it('reports absent a program not found, or an xcrun stub with no Command Line Tools', () => {
    assert.equal(resolveProgram('nothing', at()), null);
    const stub = { ...at('/usr/bin/git'), isStub: (path: string) => path === '/usr/bin/git' };
    assert.equal(resolveProgram('git', stub), null);
  });

  it('checks an absolute program is there', () => {
    assert.equal(resolveProgram('/usr/bin/git', at('/usr/bin/git')), '/usr/bin/git');
    assert.equal(resolveProgram('/usr/bin/git', at()), null);
  });

  it('never resolves a refused program', () => {
    assert.equal(resolveProgram('sh', at('/bin/sh')), null);
  });
});

describe('the environment a spawned program gets', () => {
  it('holds only the declared variables', () => {
    const env = { HOME: '/Users/me', LANG: 'en_GB', SECRET: 'x', DYLD_INSERT_LIBRARIES: 'evil' };
    assert.deepEqual(filterEnvironment(env, ['HOME', 'LANG', 'MISSING']), {
      HOME: '/Users/me',
      LANG: 'en_GB',
    });
  });

  it('never reads a variable through the prototype, or one holding a NUL', () => {
    assert.deepEqual(filterEnvironment({}, ['toString', '__proto__']), {});
    assert.deepEqual(filterEnvironment({ A: 'x\0y' }, ['A']), {});
  });
});
