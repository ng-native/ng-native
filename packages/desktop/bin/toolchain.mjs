/**
 * The tools a from-source build of the desktop host needs, checked before it starts so a missing or
 * old one stops it with the line that fixes it, not a compiler error minutes in.
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
 * How long the first build of the host for a React Native version takes on an Apple silicon Mac,
 * measured cold: React Native and Hermes compile from source.
 */
export const FIRST_BUILD_NOTE =
  'Building the desktop host from source for the first time for this React Native version: React ' +
  'Native and Hermes compile, which takes about 4 minutes on an Apple silicon Mac (about 6 for a ' +
  'universal release build). Later runs reuse it.';

/**
 * @typedef {{ run(command: string, args: string[], options?: { capture?: boolean }): { status: number, stdout: string } }} ToolRunner
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
 * What is missing or too old for a from-source build, each with the line that fixes it. Empty when
 * the build can start.
 *
 * @param {ToolRunner} sys
 * @returns {string[]}
 */
export function toolchainProblems(sys) {
  const developer = developerToolsProblem(sys);
  return [
    ...(developer === null ? [] : [developer]),
    .../** @type {const} */ ([
      ['cmake', 'CMake'],
      ['ninja', 'Ninja'],
    ]).flatMap(([tool, name]) => {
      const problem = buildToolProblem(sys, tool, name);
      return problem === null ? [] : [problem];
    }),
  ];
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
 */
function buildToolProblem(sys, tool, name) {
  const text = probe(sys, tool, ['--version']);
  if ('missing' in text) return `${name} is not installed. Install it: brew install ${tool}`;
  if ('failed' in text) {
    return `${name} is installed but ${text.failed}. Check it runs, or reinstall it: brew reinstall ${tool}`;
  }
  const version = text.stdout.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1];
  const minimum = TOOLCHAIN_MINIMUMS[tool];
  if (!version) {
    return `${name} printed no version for ${tool} --version. Reinstall it: brew reinstall ${tool}`;
  }
  if (!atLeast(version, minimum)) {
    return `${name} ${version} is older than ${minimum}. Update it: brew upgrade ${tool}`;
  }
  return null;
}

/**
 * Stops with every problem `toolchainProblems` finds, before anything builds.
 *
 * @param {ToolRunner} sys
 */
export function checkToolchain(sys) {
  const problems = toolchainProblems(sys);
  if (problems.length > 0) {
    throw new UsageError(
      [
        'The desktop host cannot be built from source on this Mac:',
        ...problems.map((p) => `- ${p}`),
      ].join('\n'),
    );
  }
}
