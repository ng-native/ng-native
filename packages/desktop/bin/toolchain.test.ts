import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { UsageError } from './host.mjs';
import { atLeast, checkToolchain, TOOLCHAIN_MINIMUMS, toolchainProblems } from './toolchain.mjs';

type Answer = { status: number; stdout: string } | 'missing' | 'denied';

/** A Mac whose tools answer from `answers` by command line; a missing one fails to spawn. */
function mac(answers: Record<string, Answer>) {
  const asked: string[] = [];
  return {
    asked,
    run(command: string, args: string[]) {
      const line = [command, ...args].join(' ');
      asked.push(line);
      const answer = answers[line] ?? 'missing';
      if (answer === 'missing')
        throw Object.assign(new Error(`spawnSync ${command} ENOENT`), { code: 'ENOENT' });
      if (answer === 'denied')
        throw Object.assign(new Error(`spawnSync ${command} EACCES`), { code: 'EACCES' });
      return answer;
    },
  };
}

const ok = (stdout: string) => ({ status: 0, stdout });

const EVERYTHING: Record<string, Answer> = {
  'xcode-select --print-path': ok('/Library/Developer/CommandLineTools\n'),
  'xcrun swiftc --version': ok(
    'swift-driver version: 1.120.5 Apple Swift version 6.0.3 (swiftlang-6.0.3.1.10 clang-1600.0.30.1)\nTarget: arm64-apple-macosx15.0\n',
  ),
  'cmake --version': ok(
    'cmake version 3.25.0\n\nCMake suite maintained and supported by Kitware (kitware.com/cmake).\n',
  ),
  'ninja --version': ok('1.10.2\n'),
};

describe('toolchainProblems', () => {
  it('finds nothing wrong with the Command Line Tools, CMake and Ninja at their minimums', () => {
    assert.deepEqual(toolchainProblems(mac(EVERYTHING)), []);
  });

  it('names the install for each tool that is missing', () => {
    const problems = toolchainProblems(
      mac({ 'xcode-select --print-path': { status: 2, stdout: '' } }),
    );
    assert.equal(problems.length, 3);
    assert.match(problems[0]!, /Command Line Tools are not installed.*xcode-select --install/);
    assert.match(problems[1]!, /CMake is not installed.*brew install cmake/);
    assert.match(problems[2]!, /Ninja is not installed.*brew install ninja/);
  });

  it('names the update for each tool that is too old', () => {
    const problems = toolchainProblems(
      mac({
        ...EVERYTHING,
        'xcrun swiftc --version': ok(
          'Apple Swift version 5.10 (swiftlang-5.10.0.13 clang-1500.3.9.4)\n',
        ),
        'cmake --version': ok('cmake version 3.24.4\n'),
        'ninja --version': ok('1.9.0\n'),
      }),
    );
    assert.equal(problems.length, 3);
    assert.match(problems[0]!, /Swift 5\.10 is older than 6\.0.*xcode-select --install/);
    assert.match(problems[1]!, /CMake 3\.24\.4 is older than 3\.25.*brew upgrade cmake/);
    assert.match(problems[2]!, /Ninja 1\.9\.0 is older than 1\.10.*brew upgrade ninja/);
  });

  it('says a tool that is there but cannot run failed to run, not that it is missing', () => {
    const problems = toolchainProblems(
      mac({
        ...EVERYTHING,
        'xcode-select --print-path': 'denied',
        'cmake --version': 'denied',
        'ninja --version': { status: 1, stdout: '' },
      }),
    );
    assert.equal(problems.length, 3);
    assert.match(problems[0]!, /^xcode-select --print-path could not run \(EACCES\)/);
    assert.match(problems[1]!, /^CMake is installed but cmake --version could not run \(EACCES\)/);
    assert.match(problems[2]!, /^Ninja is installed but ninja --version failed \(status 1\)/);
    assert.doesNotMatch(problems.join('\n'), /not installed/);
  });

  it('says xcode-select or xcrun failed, not that tools are missing, on another exit status', () => {
    const selectFailed = toolchainProblems(
      mac({ ...EVERYTHING, 'xcode-select --print-path': { status: 1, stdout: '' } }),
    );
    assert.equal(selectFailed.length, 1);
    assert.match(selectFailed[0]!, /^xcode-select --print-path failed \(status 1\)/);
    // xcrun exits 69 while Xcode's licence is not yet accepted.
    const swiftFailed = toolchainProblems(
      mac({ ...EVERYTHING, 'xcrun swiftc --version': { status: 69, stdout: '' } }),
    );
    assert.equal(swiftFailed.length, 1);
    assert.match(swiftFailed[0]!, /^xcrun swiftc --version failed \(status 69\)/);
    assert.match(swiftFailed[0]!, /sudo xcodebuild -license/);
    assert.doesNotMatch([...selectFailed, ...swiftFailed].join('\n'), /not installed|missing/);
  });

  it('says how to get swiftc back when the selected tools have none', () => {
    const problems = toolchainProblems(
      mac({ ...EVERYTHING, 'xcrun swiftc --version': { status: 72, stdout: '' } }),
    );
    assert.deepEqual(problems.length, 1);
    assert.match(
      problems[0]!,
      /swiftc is missing[\s\S]*xcode-select -s \/Applications\/Xcode\.app/,
    );
  });

  it('keeps the minimums in step with CMakeLists.txt', async () => {
    const { readFile } = await import('node:fs/promises');
    const cmake = await readFile(new URL('../native/CMakeLists.txt', import.meta.url), 'utf8');
    assert.equal(
      cmake.match(/cmake_minimum_required\(VERSION ([\d.]+)\)/)?.[1],
      TOOLCHAIN_MINIMUMS.cmake,
    );
  });
});

describe('checkToolchain', () => {
  it('stops with every problem as a usage error, and passes a complete toolchain', () => {
    assert.throws(
      () => checkToolchain(mac({ ...EVERYTHING, 'ninja --version': 'missing' })),
      (error: unknown) =>
        error instanceof UsageError &&
        /cannot be built from source on this Mac:\n- Ninja is not installed/.test(error.message),
    );
    assert.doesNotThrow(() => checkToolchain(mac(EVERYTHING)));
  });
});

describe('atLeast', () => {
  it('compares dotted versions number by number', () => {
    assert.ok(atLeast('3.25.0', '3.25'));
    assert.ok(atLeast('3.31', '3.25'));
    assert.ok(atLeast('4.0', '3.25'));
    assert.ok(!atLeast('3.9', '3.25'));
    assert.ok(!atLeast('1.9.9', '1.10'));
    assert.ok(atLeast('6.0.3', '6.0'));
  });
});
