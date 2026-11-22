import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { UsageError } from './host.mjs';
import {
  atLeast,
  checkToolchain,
  LINUX_LIBRARIES,
  LINUX_LIBRARY_MINIMUMS,
  LINUX_TOOLS,
  linuxFamily,
  TOOLCHAIN_MINIMUMS,
  toolchainProblems,
} from './toolchain.mjs';

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

/** A Linux whose tools answer from `answers`, with `osRelease` as its /etc/os-release. */
function linux(answers: Record<string, Answer>, osRelease = '') {
  return {
    ...mac(answers),
    readFile(file: string) {
      if (file !== '/etc/os-release' || !osRelease) throw new Error(`ENOENT ${file}`);
      return osRelease;
    },
  };
}

const LINUX_EVERYTHING: Record<string, Answer> = {
  'cmake --version': ok('cmake version 3.25.0\n'),
  'ninja --version': ok('1.10.2\n'),
  ...Object.fromEntries(LINUX_TOOLS.map((tool) => [`${tool.command} --version`, ok('x\n')])),
  ...Object.fromEntries(
    LINUX_LIBRARIES.map((library) => [
      `pkg-config --modversion ${library.module}`,
      ok(`${LINUX_LIBRARY_MINIMUMS[library.module] ?? '1.0'}\n`),
    ]),
  ),
};

const FEDORA = 'NAME="Fedora Linux"\nID=fedora\n';
const ALMA = 'NAME="AlmaLinux"\nID="almalinux"\nID_LIKE="rhel centos fedora"\n';
const UBUNTU = 'NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n';

describe('toolchainProblems on Linux', () => {
  it('finds nothing wrong with every tool there and each library at its minimum', () => {
    assert.deepEqual(toolchainProblems(linux(LINUX_EVERYTHING, UBUNTU), 'linux'), []);
  });

  it('names the package to install for this distribution’s family', () => {
    const missing = { ...LINUX_EVERYTHING, 'ld.lld --version': 'missing' as const };
    assert.deepEqual(toolchainProblems(linux(missing, UBUNTU), 'linux'), [
      'lld is not installed. Install it: sudo apt install lld',
    ]);
    assert.deepEqual(toolchainProblems(linux(missing, FEDORA), 'linux'), [
      'lld is not installed. Install it: sudo dnf install lld',
    ]);
    // Without an os-release it knows, both families' names.
    assert.match(
      toolchainProblems(linux(missing), 'linux')[0]!,
      /install lld on Debian or Ubuntu, lld on Fedora or RHEL/,
    );
  });

  it('says where RHEL keeps Ninja and the GTK headers, only when something is missing there', () => {
    const problems = toolchainProblems(
      linux({ ...LINUX_EVERYTHING, 'ninja --version': 'missing' }, ALMA),
      'linux',
    );
    assert.deepEqual(problems, [
      'Ninja is not installed. Install it: sudo dnf install ninja-build',
      'On RHEL and its rebuilds, Ninja and the GTK and libadwaita headers are in the CRB repository: enable it first with sudo dnf config-manager --set-enabled crb',
    ]);
    assert.deepEqual(toolchainProblems(linux(LINUX_EVERYTHING, ALMA), 'linux'), []);
  });

  it('names each library pkg-config misses or finds too old, and skips them without pkg-config', () => {
    const problems = toolchainProblems(
      linux(
        {
          ...LINUX_EVERYTHING,
          'pkg-config --modversion gtk4': { status: 1, stdout: '' },
          'pkg-config --modversion libadwaita-1': ok('1.3.6\n'),
          'pkg-config --modversion openssl': ok('\n'),
        },
        UBUNTU,
      ),
      'linux',
    );
    assert.deepEqual(problems, [
      'pkg-config finds no gtk4. Install its headers: sudo apt install libgtk-4-dev',
      'libadwaita-1 1.3.6 is older than 1.4, the oldest the GTK host builds with. Update it (sudo apt install --only-upgrade libadwaita-1-dev), or build on a newer distribution.',
      'pkg-config printed no version for openssl. Reinstall its headers: sudo apt install --reinstall libssl-dev',
    ]);
    const noPkgConfig = linux({ ...LINUX_EVERYTHING, 'pkg-config --version': 'missing' }, UBUNTU);
    assert.deepEqual(toolchainProblems(noPkgConfig, 'linux'), [
      'pkg-config is not installed. Install it: sudo apt install pkg-config',
    ]);
    assert.ok(!noPkgConfig.asked.some((line) => line.includes('--modversion')));
  });

  it('says a tool that cannot run failed, and takes one whose --version exits nonzero as there', () => {
    const problems = toolchainProblems(
      linux(
        {
          ...LINUX_EVERYTHING,
          'clang --version': 'denied',
          'unzip --version': { status: 10, stdout: '' },
        },
        FEDORA,
      ),
      'linux',
    );
    assert.deepEqual(problems, [
      'clang is installed but clang --version could not run (EACCES). Check it runs, or reinstall it: sudo dnf reinstall clang',
    ]);
  });

  it('keeps the library minimums in step with what the GTK host and libcurl ask pkg-config for', async () => {
    const { readFile } = await import('node:fs/promises');
    const gtk = await readFile(new URL('../native/gtk/CMakeLists.txt', import.meta.url), 'utf8');
    const curl = await readFile(new URL('../native/cmake/curl.cmake', import.meta.url), 'utf8');
    const asked = [
      ...`${gtk}\n${curl}`.matchAll(
        /pkg_check_modules\(\w+ REQUIRED(?: IMPORTED_TARGET)? ([^)]*)\)/g,
      ),
    ]
      .flatMap((match) => match[1]!.split(/\s+/))
      .filter(Boolean);
    const floors = Object.fromEntries(
      asked.flatMap((each) => {
        const [module, version] = each.split('>=');
        return version ? [[module!, version]] : [];
      }),
    );
    assert.deepEqual(floors, LINUX_LIBRARY_MINIMUMS);
    const modules = asked.map((each) => each.split('>=')[0]);
    for (const module of modules) {
      assert.ok(
        LINUX_LIBRARIES.some((library) => library.module === module),
        `${module} is checked`,
      );
    }
  });
});

describe('the toolchain probes', () => {
  it('ask each tool quietly, so a usage message on stderr never reaches the terminal', () => {
    const options: unknown[] = [];
    const sys = linux(LINUX_EVERYTHING, UBUNTU);
    const run = sys.run;
    toolchainProblems(
      {
        ...sys,
        run(command: string, args: string[], option?: unknown) {
          options.push(option);
          return run(command, args);
        },
      },
      'linux',
    );
    assert.ok(options.length > LINUX_TOOLS.length);
    for (const option of options) assert.deepEqual(option, { capture: true, quiet: true });
  });

  it('are run by the system with stderr dropped, and stdout kept', () => {
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { system } from ${JSON.stringify(new URL('./host.mjs', import.meta.url).href)};
         const { stdout } = system.run('sh', ['-c', 'echo out; echo usage >&2'], { capture: true, quiet: true });
         process.stdout.write('got ' + stdout);`,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, 'got out\n');
    assert.equal(child.stderr, '');
  });
});

describe('checkToolchain on Linux', () => {
  it('stops with every problem, naming this machine rather than a Mac', () => {
    assert.throws(
      () =>
        checkToolchain(linux({ ...LINUX_EVERYTHING, 'git --version': 'missing' }, UBUNTU), 'linux'),
      (error: unknown) =>
        error instanceof UsageError &&
        /cannot be built from source on this machine:\n- Git is not installed/.test(error.message),
    );
  });
});

describe('linuxFamily', () => {
  it('reads Debian’s and Fedora’s families from ID and ID_LIKE, and RHEL’s rebuilds as el', () => {
    assert.deepEqual(linuxFamily(UBUNTU), { family: 'apt', el: false });
    assert.deepEqual(linuxFamily('ID=debian\n'), { family: 'apt', el: false });
    assert.deepEqual(linuxFamily(FEDORA), { family: 'dnf', el: false });
    assert.deepEqual(linuxFamily(ALMA), { family: 'dnf', el: true });
    assert.deepEqual(linuxFamily('ID="rhel"\n'), { family: 'dnf', el: true });
    assert.equal(linuxFamily('ID=arch\n'), null);
    assert.equal(linuxFamily(''), null);
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
