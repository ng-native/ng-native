/**
 * 0.24.0 adds Linux as an OS: the `OS` token and `Platform.OS` say `'linux'` there. A Linux bundle
 * takes React Native's iOS files, as a macOS one does, but app code sees `'linux'`, so a check an
 * app wrote for the OSes it knew can be wrong there:
 *
 * - `=== 'ios'` is false on Linux, and `!== 'ios'` true;
 * - `=== 'macos'` is false on Linux, where a check meant as "a desktop OS" wants `DESKTOP`;
 *   `!== 'macos'` is true there;
 * - `!== 'android'` is true on Linux, which then takes a branch that may be written for iOS.
 *
 * Which of these an app wants is its own to say, so nothing is rewritten: each comparison in the
 * app's TypeScript, JavaScript, templates and inline templates is noted with its file and line, as
 * `os-comparisons-on-macos` did for macOS. An exhaustive `switch` or a `Record` over the OS type is
 * a compile error until it has a `linux` entry, so tsc finds those.
 */
const { osComparisonNotes } = require('./os-comparisons-on-macos.cjs');

const EQUALITY = new Set(['===', '==', '!==', '!=']);

/**
 * Why a comparison answers differently on Linux, or null when it does not.
 *
 * @param {string} operator
 * @param {string} literal the string compared with
 */
function why(operator, literal) {
  if (!EQUALITY.has(operator)) return null;
  const negated = operator.startsWith('!');
  if (literal === 'ios') {
    return negated
      ? "is true on Linux, where the OS is 'linux'. Check that the branch is right there."
      : "is false on Linux, where the OS is 'linux'. If the branch is about React Native's iOS behaviour, which Linux shares, check for 'linux' too.";
  }
  if (literal === 'macos') {
    return negated
      ? "is true on Linux, where the OS is 'linux'. If the branch is for every OS but a desktop one, inject DESKTOP instead."
      : "is false on Linux, where the OS is 'linux'. If the branch is for every desktop OS, inject DESKTOP instead.";
  }
  if (literal === 'android' && negated) {
    return 'is true on Linux too, so Linux takes this branch. Check that it is right there.';
  }
  return null;
}

/** @param {import('./host.cjs').Host} host */
const osComparisonsOnLinux = (host) => osComparisonNotes(host, 'ios|android|macos', why);

module.exports = { osComparisonsOnLinux };
