/**
 * The tools a from-source build of the desktop host needs, checked before it starts so a missing or
 * old one stops it with the line that fixes it, not a compiler error minutes in: Xcode's tools,
 * CMake and Ninja on a Mac; on Linux clang, lld, CMake, Ninja, the tools the fetch and build
 * scripts call, and the libraries the GTK host links, found through pkg-config.
 */
import { UsageError } from './host.mjs';

/**
 * The oldest version of each tool the host builds with. Swift 6 comes with Xcode 16, the oldest
 * Xcode React Native 0.88 builds with; CMake 3.25 is `native/CMakeLists.txt`'s minimum.
 */
export const TOOLCHAIN_MINIMUMS = /** @type {const} */ ({
  swift: '6.0',
  cmake: '3.25',
  ninja: '1.10',
});

/**
 * The oldest version of each library the GTK host links that has a floor, as `native/gtk` and
 * `native/cmake/curl.cmake` ask pkg-config for it.
 */
export const LINUX_LIBRARY_MINIMUMS = /** @type {Readonly<Record<string, string>>} */ ({
  gtk4: '4.10',
  'libadwaita-1': '1.4',
  'libsecret-1': '0.20',
  openssl: '3.0',
});

/**
 * How long the first build of the host for a React Native version takes on an Apple silicon Mac,
 * measured cold: React Native and Hermes compile from source.
 */
export const FIRST_BUILD_NOTE =
  'Building the desktop host from source for the first time for this React Native version: React ' +
  'Native and Hermes compile, which takes about 4 minutes on an Apple silicon Mac (about 6 for a ' +
  'universal release build). Later runs reuse it.';

/** The same note for the GTK host, which compiles ICU and libcurl as well. */
export const LINUX_FIRST_BUILD_NOTE =
  'Building the desktop host from source for the first time for this React Native version: React ' +
  'Native, Hermes, ICU and libcurl compile, which takes many minutes. Later runs reuse it.';

/**
 * @typedef {{ run(command: string, args: string[], options?: { capture?: boolean }): { status: number, stdout: string }, readFile?(file: string): string }} ToolRunner
 */

/**
 * What running a tool gave: its output; `missing` when it is not on the PATH (spawn's ENOENT); or
 * `failed`, why it is there but did not run (another spawn error, such as EACCES, or a nonzero
 * exit).
 *
 * @param {ToolRunner} sys
 * @param {string} command
 * @param {string[]} args
 * @returns {{ stdout: string } | { missing: true } | { failed: string, exited: boolean, status?: number | null }}
 */
function probe(sys, command, args) {
  const line = [command, ...args].join(' ');
  try {
    const result = sys.run(command, args, { capture: true });
    if (result.status === 0) return { stdout: result.stdout };
    return {
      failed: `${line} failed (status ${result.status})`,
      exited: true,
      status: result.status,
    };
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error)?.code;
    if (code === 'ENOENT') return { missing: true };
    return { failed: `${line} could not run (${code ?? String(error)})`, exited: false };
  }
}

/**
 * Whether `version` (dotted numbers) is `minimum` or later.
 *
 * @param {string} version
 * @param {string} minimum
 */
export function atLeast(version, minimum) {
  const have = version.split('.').map(Number);
  const want = minimum.split('.').map(Number);
  for (let i = 0; i < want.length; i++) {
    const a = have[i] ?? 0;
    const b = want[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

/**
 * The commands a problem line names to install, reinstall or update a package.
 *
 * @typedef {{ install(pkg: Package): string, reinstall(pkg: Package): string, upgrade(pkg: Package): string }} Installer
 * @typedef {{ brew?: string, apt: string, dnf: string }} Package
 */

/** @type {Installer} */
const HOMEBREW = {
  install: (pkg) => `brew install ${pkg.brew}`,
  reinstall: (pkg) => `brew reinstall ${pkg.brew}`,
  upgrade: (pkg) => `brew upgrade ${pkg.brew}`,
};

/** CMake and Ninja, which every host builds with, and their packages. */
const BUILD_TOOLS = /** @type {const} */ ([
  { tool: 'cmake', name: 'CMake', pkg: { brew: 'cmake', apt: 'cmake', dnf: 'cmake' } },
  { tool: 'ninja', name: 'Ninja', pkg: { brew: 'ninja', apt: 'ninja-build', dnf: 'ninja-build' } },
]);

/**
 * Each other tool the Linux build runs, by its command, with its package in Debian's and Fedora's
 * families. `shasum` is Perl's, which the build scripts key their folders with.
 *
 * @type {readonly { command: string, name: string, pkg: Package }[]}
 */
export const LINUX_TOOLS = [
  { command: 'clang', name: 'clang', pkg: { apt: 'clang', dnf: 'clang' } },
  { command: 'clang++', name: 'clang++', pkg: { apt: 'clang', dnf: 'clang' } },
  { command: 'ld.lld', name: 'lld', pkg: { apt: 'lld', dnf: 'lld' } },
  { command: 'git', name: 'Git', pkg: { apt: 'git', dnf: 'git' } },
  { command: 'curl', name: 'curl', pkg: { apt: 'curl', dnf: 'curl' } },
  { command: 'unzip', name: 'unzip', pkg: { apt: 'unzip', dnf: 'unzip' } },
  { command: 'xz', name: 'xz', pkg: { apt: 'xz-utils', dnf: 'xz' } },
  { command: 'perl', name: 'Perl', pkg: { apt: 'perl', dnf: 'perl' } },
  { command: 'shasum', name: 'shasum', pkg: { apt: 'perl', dnf: 'perl-Digest-SHA' } },
  { command: 'python3', name: 'Python 3', pkg: { apt: 'python3', dnf: 'python3' } },
  {
    command: 'pkg-config',
    name: 'pkg-config',
    pkg: { apt: 'pkg-config', dnf: 'pkgconf-pkg-config' },
  },
];

/**
 * Each library the GTK host links, by its pkg-config name, with its development package.
 *
 * @type {readonly { module: string, pkg: Package }[]}
 */
export const LINUX_LIBRARIES = [
  { module: 'gtk4', pkg: { apt: 'libgtk-4-dev', dnf: 'gtk4-devel' } },
  { module: 'libadwaita-1', pkg: { apt: 'libadwaita-1-dev', dnf: 'libadwaita-devel' } },
  { module: 'pangocairo', pkg: { apt: 'libpango1.0-dev', dnf: 'pango-devel' } },
  { module: 'gio-unix-2.0', pkg: { apt: 'libglib2.0-dev', dnf: 'glib2-devel' } },
  { module: 'x11', pkg: { apt: 'libx11-dev', dnf: 'libX11-devel' } },
  { module: 'libsecret-1', pkg: { apt: 'libsecret-1-dev', dnf: 'libsecret-devel' } },
  { module: 'fontconfig', pkg: { apt: 'libfontconfig-dev', dnf: 'fontconfig-devel' } },
  { module: 'pangoft2', pkg: { apt: 'libpango1.0-dev', dnf: 'pango-devel' } },
  { module: 'openssl', pkg: { apt: 'libssl-dev', dnf: 'openssl-devel' } },
  { module: 'libnghttp2', pkg: { apt: 'libnghttp2-dev', dnf: 'libnghttp2-devel' } },
  { module: 'zlib', pkg: { apt: 'zlib1g-dev', dnf: 'zlib-devel' } },
  { module: 'sqlite3', pkg: { apt: 'libsqlite3-dev', dnf: 'sqlite-devel' } },
];

/**
 * The package family of a Linux, from `/etc/os-release`'s `ID` and `ID_LIKE`: Debian's (Debian,
 * Ubuntu) or Fedora's (Fedora, RHEL and its rebuilds), or null for another. `el` is true on RHEL and
 * its rebuilds, whose CRB repository has Ninja and the GTK headers.
 *
 * @param {string} osRelease the file's text
 * @returns {{ family: 'apt' | 'dnf', el: boolean } | null}
 */
export function linuxFamily(osRelease) {
  /** @param {string} key */
  const value = (key) =>
    osRelease.match(new RegExp(`^${key}=["']?([^"'\\n]*)`, 'm'))?.[1]?.toLowerCase() ?? '';
  const ids = [value('ID'), ...value('ID_LIKE').split(/\s+/)].filter(Boolean);
  if (ids.some((id) => id === 'debian' || id === 'ubuntu')) return { family: 'apt', el: false };
  if (ids.some((id) => ['fedora', 'rhel', 'centos'].includes(id))) {
    return { family: 'dnf', el: ids.includes('rhel') || ids.includes('centos') };
  }
  return null;
}

/**
 * The install commands for a Linux family, or, for a family not known, both families' packages.
 *
 * @param {{ family: 'apt' | 'dnf' } | null} found
 * @returns {Installer}
 */
function linuxInstaller(found) {
  if (found?.family === 'apt') {
    return {
      install: (pkg) => `sudo apt install ${pkg.apt}`,
      reinstall: (pkg) => `sudo apt install --reinstall ${pkg.apt}`,
      upgrade: (pkg) => `sudo apt install --only-upgrade ${pkg.apt}`,
    };
  }
  if (found?.family === 'dnf') {
    return {
      install: (pkg) => `sudo dnf install ${pkg.dnf}`,
      reinstall: (pkg) => `sudo dnf reinstall ${pkg.dnf}`,
      upgrade: (pkg) => `sudo dnf upgrade ${pkg.dnf}`,
    };
  }
  /** @param {string} verb @param {Package} pkg */
  const both = (verb, pkg) =>
    `${verb} ${pkg.apt} on Debian or Ubuntu, ${pkg.dnf} on Fedora or RHEL, or its equivalent`;
  return {
    install: (pkg) => both('install', pkg),
    reinstall: (pkg) => both('reinstall', pkg),
    upgrade: (pkg) => both('update', pkg),
  };
}

/**
 * What is missing or too old for a from-source build of the host for `os`, each with the line that
 * fixes it. Empty when the build can start.
 *
 * @param {ToolRunner} sys
 * @param {'macos' | 'linux'} [os]
 * @returns {string[]}
 */
export function toolchainProblems(sys, os = 'macos') {
  if (os === 'linux') return linuxProblems(sys);
  const developer = developerToolsProblem(sys);
  return [
    ...(developer === null ? [] : [developer]),
    ...BUILD_TOOLS.flatMap(({ tool, name, pkg }) => {
      const problem = buildToolProblem(sys, tool, name, HOMEBREW, pkg);
      return problem === null ? [] : [problem];
    }),
  ];
}

/**
 * What is wrong with the Linux toolchain: CMake or Ninja missing or too old, each other tool
 * missing or failing to run, and each library pkg-config does not find or finds too old.
 *
 * @param {ToolRunner} sys
 * @returns {string[]}
 */
function linuxProblems(sys) {
  const found = linuxFamily(osRelease(sys));
  const installer = linuxInstaller(found);
  const problems = BUILD_TOOLS.flatMap(({ tool, name, pkg }) => {
    const problem = buildToolProblem(sys, tool, name, installer, pkg);
    return problem === null ? [] : [problem];
  });
  const tools = LINUX_TOOLS.flatMap((tool) => {
    const problem = linuxToolProblem(sys, tool, installer);
    return problem === null ? [] : [{ command: tool.command, problem }];
  });
  problems.push(...tools.map((each) => each.problem));
  // Without pkg-config every library would read as missing.
  if (!tools.some((each) => each.command === 'pkg-config')) {
    for (const library of LINUX_LIBRARIES) {
      const problem = libraryProblem(sys, library, installer);
      if (problem !== null) problems.push(problem);
    }
  }
  if (problems.length > 0 && found?.el) {
    problems.push(
      'On RHEL and its rebuilds, Ninja and the GTK and libadwaita headers are in the CRB ' +
        'repository: enable it first with sudo dnf config-manager --set-enabled crb',
    );
  }
  return problems;
}

/**
 * `/etc/os-release`'s text, or nothing where it cannot be read, so both families' packages are
 * named.
 *
 * @param {ToolRunner} sys
 */
function osRelease(sys) {
  try {
    return sys.readFile?.('/etc/os-release') ?? '';
  } catch {
    return '';
  }
}

/**
 * What is wrong with one tool the Linux build runs, or null. Being there and running is enough:
 * unzip and shasum print no version for --version, and unzip exits nonzero.
 *
 * @param {ToolRunner} sys
 * @param {{ command: string, name: string, pkg: Package }} tool
 * @param {Installer} installer
 */
function linuxToolProblem(sys, { command, name, pkg }, installer) {
  const text = probe(sys, command, ['--version']);
  if ('missing' in text) return `${name} is not installed. Install it: ${installer.install(pkg)}`;
  if ('failed' in text && !text.exited) {
    return `${name} is installed but ${text.failed}. Check it runs, or reinstall it: ${installer.reinstall(pkg)}`;
  }
  return null;
}

/**
 * What is wrong with one library the GTK host links, or null.
 *
 * @param {ToolRunner} sys
 * @param {{ module: string, pkg: Package }} library
 * @param {Installer} installer
 */
function libraryProblem(sys, { module, pkg }, installer) {
  const text = probe(sys, 'pkg-config', ['--modversion', module]);
  if (!('stdout' in text)) {
    return `pkg-config finds no ${module}. Install its headers: ${installer.install(pkg)}`;
  }
  const minimum = LINUX_LIBRARY_MINIMUMS[module];
  const version = text.stdout.trim().match(/^\d+(?:\.\d+)*/)?.[0];
  if (!version) {
    return `pkg-config printed no version for ${module}. Reinstall its headers: ${installer.reinstall(pkg)}`;
  }
  if (minimum && !atLeast(version, minimum)) {
    return (
      `${module} ${version} is older than ${minimum}, the oldest the GTK host builds with. ` +
      `Update it (${installer.upgrade(pkg)}), or build on a newer distribution.`
    );
  }
  return null;
}

/**
 * What is wrong with Xcode or its Command Line Tools and their swiftc, or null.
 *
 * @param {ToolRunner} sys
 */
function developerToolsProblem(sys) {
  const developer = probe(sys, 'xcode-select', ['--print-path']);
  if ('failed' in developer && !developer.exited) {
    return `${developer.failed}. Check its permissions, or reinstall: xcode-select --install`;
  }
  // No developer folder selected: xcode-select exits 2. Any other status is a failure to run.
  if ('failed' in developer && developer.status !== 2) {
    return `${developer.failed}. Reinstall the Command Line Tools: xcode-select --install`;
  }
  if (!('stdout' in developer) || developer.stdout.trim() === '') {
    return (
      'Xcode or its Command Line Tools are not installed. Install the Command Line Tools: ' +
      'xcode-select --install'
    );
  }
  return swiftProblem(sys);
}

/**
 * What is wrong with the selected developer tools' swiftc, or null.
 *
 * @param {ToolRunner} sys
 */
function swiftProblem(sys) {
  const swift = probe(sys, 'xcrun', ['swiftc', '--version']);
  if ('failed' in swift && !swift.exited) {
    return `${swift.failed}. Check its permissions, or reinstall: xcode-select --install`;
  }
  // xcrun exits 72 when the selected tools have no swiftc; any other status (69 while Xcode's
  // licence is not accepted) is a failure to run it.
  if ('failed' in swift && swift.status !== 72) {
    return (
      `${swift.failed}. If Xcode's licence is not yet accepted: sudo xcodebuild -license accept; ` +
      'otherwise reinstall the Command Line Tools: xcode-select --install'
    );
  }
  const version =
    'stdout' in swift ? swift.stdout.match(/Swift version (\d+(?:\.\d+)*)/)?.[1] : undefined;
  if (!version) {
    return (
      'swiftc is missing from the selected developer tools. Reinstall the Command Line Tools ' +
      '(xcode-select --install), or select Xcode: sudo xcode-select -s /Applications/Xcode.app'
    );
  }
  if (!atLeast(version, TOOLCHAIN_MINIMUMS.swift)) {
    return (
      `Swift ${version} is older than ${TOOLCHAIN_MINIMUMS.swift} (Xcode 16). Update Xcode or ` +
      'the Command Line Tools from Software Update, or install them again: xcode-select --install'
    );
  }
  return null;
}

/**
 * What is wrong with CMake or Ninja, or null: "not installed" only when it is not on the PATH.
 *
 * @param {ToolRunner} sys
 * @param {'cmake' | 'ninja'} tool
 * @param {string} name
 * @param {Installer} installer
 * @param {Package} pkg
 */
function buildToolProblem(sys, tool, name, installer, pkg) {
  const { install, reinstall, upgrade } = installer;
  const text = probe(sys, tool, ['--version']);
  if ('missing' in text) return `${name} is not installed. Install it: ${install(pkg)}`;
  if ('failed' in text) {
    return `${name} is installed but ${text.failed}. Check it runs, or reinstall it: ${reinstall(pkg)}`;
  }
  const version = text.stdout.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1];
  const minimum = TOOLCHAIN_MINIMUMS[tool];
  if (!version) {
    return `${name} printed no version for ${tool} --version. Reinstall it: ${reinstall(pkg)}`;
  }
  if (!atLeast(version, minimum)) {
    return `${name} ${version} is older than ${minimum}. Update it: ${upgrade(pkg)}`;
  }
  return null;
}

/**
 * Stops with every problem `toolchainProblems` finds, before anything builds.
 *
 * @param {ToolRunner} sys
 * @param {'macos' | 'linux'} [os]
 */
export function checkToolchain(sys, os = 'macos') {
  const problems = toolchainProblems(sys, os);
  if (problems.length > 0) {
    const where = os === 'linux' ? 'this machine' : 'this Mac';
    throw new UsageError(
      [
        `The desktop host cannot be built from source on ${where}:`,
        ...problems.map((p) => `- ${p}`),
      ].join('\n'),
    );
  }
}
