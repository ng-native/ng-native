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
 * A tool's output, or null when it is not there or fails.
 *
 * @param {ToolRunner} sys
 * @param {string} command
 * @param {string[]} args
 */
function output(sys, command, args) {
  try {
    const result = sys.run(command, args, { capture: true });
    return result.status === 0 ? result.stdout : null;
  } catch {
    // Not on the PATH: spawn fails before the tool runs.
    return null;
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
  const problems = [];
  const developer = output(sys, 'xcode-select', ['--print-path']);
  if (developer === null || developer.trim() === '') {
    problems.push(
      'Xcode or its Command Line Tools are not installed. Install the Command Line Tools: ' +
        'xcode-select --install',
    );
  } else {
    const swift = output(sys, 'xcrun', ['swiftc', '--version']);
    const version = swift?.match(/Swift version (\d+(?:\.\d+)*)/)?.[1];
    if (!version) {
      problems.push(
        'swiftc is missing from the selected developer tools. Reinstall the Command Line Tools ' +
          '(xcode-select --install), or select Xcode: sudo xcode-select -s /Applications/Xcode.app',
      );
    } else if (!atLeast(version, TOOLCHAIN_MINIMUMS.swift)) {
      problems.push(
        `Swift ${version} is older than ${TOOLCHAIN_MINIMUMS.swift} (Xcode 16). Update Xcode or ` +
          'the Command Line Tools from Software Update, or install them again: xcode-select --install',
      );
    }
  }
  for (const [tool, name] of /** @type {const} */ ([
    ['cmake', 'CMake'],
    ['ninja', 'Ninja'],
  ])) {
    const text = output(sys, tool, ['--version']);
    const version = text?.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1];
    const minimum = TOOLCHAIN_MINIMUMS[tool];
    if (!version) {
      problems.push(`${name} is not installed. Install it: brew install ${tool}`);
    } else if (!atLeast(version, minimum)) {
      problems.push(`${name} ${version} is older than ${minimum}. Update it: brew upgrade ${tool}`);
    }
  }
  return problems;
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
