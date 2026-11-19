/**
 * 0.23.0 reports macOS as `'macos'`: the `OS` token, `Platform.OS` and `nativePlatform()` all say
 * so, where `OS` used to fold every OS but Android and the web into `'ios'`. And `OS_VERSION` is the
 * macOS major on a Mac. So a check an app wrote for iOS can be wrong there:
 *
 * - `=== 'ios'` is false on a Mac, though iOS and macOS share most of what such a branch is for;
 * - `!== 'android'` is true on a Mac, as it was, which then takes a branch that may be written for
 *   iOS;
 * - `OS_VERSION >= 26` matches macOS 26 too, where it may be meant for iOS 26;
 *
 * Which of these an app wants is its own to say, so nothing is rewritten: each comparison in the
 * app's TypeScript, JavaScript, templates and inline templates is noted with its file and line.
 */
const { scriptKind, SOURCE, typescript } = require('./move-imports.cjs');
const { files } = require('./host.cjs');

const TEMPLATE = /\.html$/;
const EQUALITY = new Set(['===', '==', '!==', '!=']);
const ORDER = new Set(['<', '<=', '>', '>=', '===', '==', '!==', '!=']);

/**
 * Whether a file can hold a comparison worth a note at all, before it is parsed: a quoted OS of
 * `oses`, or `OS_VERSION`. A quote may be escaped, as one in a single-quoted inline template is.
 *
 * @param {string} oses the OS names, as a regular expression alternation: `ios|android`
 */
const mentionsOf = (oses) => {
  const quoted = new RegExp(/['"`](ios|android)\\?['"`]/.source.replace('ios|android', oses));
  return (text) => text !== null && (quoted.test(text) || text.includes('OS_VERSION'));
};

/**
 * A comparison in a template binding: with a quoted OS of `oses` on either side, or of
 * `OS_VERSION` with a number on either side.
 *
 * @param {string} oses
 */
const comparisonOf = (oses) =>
  new RegExp(
    [
      /(?<os>[\w.$?!]+(?:\(\))?)\s*(?<osOperator>===|!==|==|!=)\s*(?<quote>['"`])(?<literal>ios|android)\k<quote>/,
      /(?<firstQuote>['"`])(?<firstLiteral>ios|android)\k<firstQuote>\s*(?<firstOperator>===|!==|==|!=)\s*[\w$][\w.$?!]*(?:\(\))?/,
      /\bOS_VERSION\b(?:\(\))?\s*(?<versionOperator><=|>=|<|>|===|!==|==|!=)\s*\d+/,
      /\b\d+\s*(?<reversedOperator><=|>=|<|>|===|!==|==|!=)\s*OS_VERSION\b(?:\(\))?/,
    ]
      .map((pattern) => pattern.source.replace('ios|android', oses))
      .join('|'),
    'g',
  );

/**
 * Why a comparison answers differently on a Mac, or null when it does not.
 *
 * @param {string} operator
 * @param {string} literal the string compared with, when one side is a string
 * @param {boolean} version whether either side reads `OS_VERSION`
 */
function why(operator, literal, version) {
  const negated = operator.startsWith('!');
  if (EQUALITY.has(operator) && literal === 'ios') {
    return negated
      ? "is true on macOS, where the OS is now 'macos'. If the branch is for every OS but Apple's, check for 'macos' too."
      : "is false on macOS, where the OS is now 'macos'. If the branch is for every Apple OS, check for 'macos' too.";
  }
  if (EQUALITY.has(operator) && negated && literal === 'android') {
    return 'is true on macOS too, so a Mac takes this branch. Check that it is right there.';
  }
  if (ORDER.has(operator) && version) {
    return (
      'also compares the macOS version on a Mac, where macOS 26 matches too. ' +
      'Check the OS as well if it is about iOS.'
    );
  }
  return null;
}

/**
 * Notes for the comparisons in a TypeScript or JavaScript file.
 *
 * @param {(operator: string, literal: string, version: boolean) => string | null} why
 * @param {RegExp} comparison
 */
function scriptNotes(ts, file, text, why, comparison) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(ts, file),
  );
  const notes = [];
  const visit = (node) => {
    if (isInlineTemplate(ts, node)) {
      const line = source.getLineAndCharacterOfPosition(node.initializer.getStart()).line + 1;
      notes.push(...templateNotes(file, node.initializer.text, why, comparison, line));
    }
    if (ts.isBinaryExpression(node)) {
      const operator = ts.tokenToString(node.operatorToken.kind) ?? '';
      const literal = [node.left, node.right].find((side) => ts.isStringLiteralLike(side));
      const version = /\bOS_VERSION\b/.test(node.getText());
      const reason = why(operator, literal?.text ?? '', version);
      if (reason) {
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        notes.push(`${file}:${line}: ${node.getText()} ${reason}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return notes;
}

/**
 * Whether `node` is a component's inline template: a `template` property in an object literal,
 * given as a string with no substitutions.
 */
const isInlineTemplate = (ts, node) =>
  ts.isPropertyAssignment(node) &&
  (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
  node.name.text === 'template' &&
  ts.isStringLiteralLike(node.initializer);

/**
 * Notes for the comparisons in a template's bindings, `@if` and `[class]` alike.
 *
 * @param {string} file
 * @param {string} text
 * @param {(operator: string, literal: string, version: boolean) => string | null} why
 * @param {RegExp} comparison
 * @param {number} [first] the file's line the template starts on, past 1 for an inline one
 */
function templateNotes(file, text, why, comparison, first = 1) {
  const notes = [];
  // The whole template, since a comparison may break over lines; noted at the line it starts on.
  for (const match of text.matchAll(comparison)) {
    const { osOperator, literal, firstOperator, firstLiteral, versionOperator, reversedOperator } =
      match.groups ?? {};
    const reason = osOperator
      ? why(osOperator, literal, false)
      : firstOperator
        ? why(firstOperator, firstLiteral, false)
        : why(versionOperator ?? reversedOperator, '', true);
    const line = first + (text.slice(0, match.index).match(/\n/g)?.length ?? 0);
    if (reason) notes.push(`${file}:${line}: ${match[0].replace(/\s+/g, ' ')} ${reason}`);
  }
  return notes;
}

/**
 * A note, with its file and line, at each comparison in the app's TypeScript, JavaScript, templates
 * and inline templates with a quoted OS of `oses`, or of `OS_VERSION`, that `why` has a reason for.
 *
 * @param {import('./host.cjs').Host} host
 * @param {string} oses the OS names to look for, as a regular expression alternation
 * @param {(operator: string, literal: string, version: boolean) => string | null} why
 */
function osComparisonNotes(host, oses, why) {
  const ts = typescript();
  const mentions = mentionsOf(oses);
  const comparison = comparisonOf(oses);
  const notes = [];
  for (const file of files(host)) {
    const script = SOURCE.test(file) && !file.endsWith('.d.ts');
    if (!script && !TEMPLATE.test(file)) continue;
    const text = host.read(file);
    if (!mentions(text)) continue;
    notes.push(
      ...(script
        ? scriptNotes(ts, file, text, why, comparison)
        : templateNotes(file, text, why, comparison)),
    );
  }
  return notes;
}

/** @param {import('./host.cjs').Host} host */
const osComparisonsOnMacos = (host) => osComparisonNotes(host, 'ios|android', why);

module.exports = { osComparisonsOnMacos, osComparisonNotes };
