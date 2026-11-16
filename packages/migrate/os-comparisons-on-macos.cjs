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
 * Whether a file can hold a comparison worth a note at all, before it is parsed. A quote may be
 * escaped, as one in a single-quoted inline template is.
 */
const mentions = (text) =>
  text !== null && (/['"`](ios|android)\\?['"`]/.test(text) || text.includes('OS_VERSION'));

/** A comparison in a template binding: with a quoted OS, or of `OS_VERSION` with a number. */
const COMPARISON = new RegExp(
  [
    /(?<os>[\w.$?!]+(?:\(\))?)\s*(?<osOperator>===|!==|==|!=)\s*(?<quote>['"`])(?<literal>ios|android)\k<quote>/,
    /\bOS_VERSION\b(?:\(\))?\s*(?<versionOperator><=|>=|<|>|===|!==|==|!=)\s*\d+/,
    /\b\d+\s*(?<reversedOperator><=|>=|<|>|===|!==|==|!=)\s*OS_VERSION\b(?:\(\))?/,
  ]
    .map((pattern) => pattern.source)
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

/** Notes for the comparisons in a TypeScript or JavaScript file. */
function scriptNotes(ts, file, text) {
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
      notes.push(...templateNotes(file, node.initializer.text, line));
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
 * @param {number} [first] the file's line the template starts on, past 1 for an inline one
 */
function templateNotes(file, text, first = 1) {
  const notes = [];
  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(COMPARISON)) {
      const { osOperator, literal, versionOperator, reversedOperator } = match.groups ?? {};
      const reason = osOperator
        ? why(osOperator, literal, false)
        : why(versionOperator ?? reversedOperator, '', true);
      if (reason) notes.push(`${file}:${first + index}: ${match[0]} ${reason}`);
    }
  });
  return notes;
}

/** @param {import('./host.cjs').Host} host */
function osComparisonsOnMacos(host) {
  const ts = typescript();
  const notes = [];
  for (const file of files(host)) {
    const script = SOURCE.test(file) && !file.endsWith('.d.ts');
    if (!script && !TEMPLATE.test(file)) continue;
    const text = host.read(file);
    if (!mentions(text)) continue;
    notes.push(...(script ? scriptNotes(ts, file, text) : templateNotes(file, text)));
  }
  return notes;
}

module.exports = { osComparisonsOnMacos };
