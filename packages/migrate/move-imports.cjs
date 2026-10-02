/**
 * Moves named imports from one entry point to another, for a release that moved what an entry
 * point exports.
 *
 * `table` maps an entry point to the names that left it and where each one went:
 *
 *     { '@ng-native/expo/store': { Storage: '@ng-native/expo/async-storage' } }
 *
 * Every source file is parsed with TypeScript, and each `import { ... } from` and
 * `export { ... } from` that names a moved export is split: one statement per new entry point, and
 * the old one kept for the names that stayed. `type` modifiers and `as` aliases go with their name.
 * Only the statement is replaced, so the file's comments and formatting stay as they were. What
 * cannot be split by reading the statement alone (a namespace import, `export *`, `require()`,
 * `import()`, or a test's `vi.mock`) is left alone and answered as a note with its file and line.
 * A second run finds nothing to move, so running it again changes nothing.
 */
const { files } = require('./host.cjs');

const SOURCE = /\.[cm]?[jt]sx?$/;
const MOCKS = /^(mock|doMock|importActual|requireActual)$/;

/** @typedef {Record<string, Record<string, string>>} Table */

/** Where each moved name of an entry point now comes from, as a note says it. */
function where(moves) {
  const byTarget = new Map();
  for (const [name, target] of Object.entries(moves)) {
    byTarget.set(target, [...(byTarget.get(target) ?? []), name]);
  }
  return [...byTarget]
    .map(([target, names]) => `${names.join(', ')} from '${target}'`)
    .join(' and ');
}

/**
 * The workspace's TypeScript, whose JavaScript API parses the files. TypeScript 7 has no
 * JavaScript API, and cannot even be `require`d.
 */
function typescript() {
  let ts = null;
  try {
    ts = require('typescript');
  } catch {
    // Reported below, with what to do instead.
  }
  if (typeof ts?.createSourceFile !== 'function') {
    throw new Error(
      'Moving imports needs TypeScript 5.9 or 6, whose JavaScript API it parses with, and the ' +
        'workspace has none (TypeScript 7 has no JavaScript API). Run npx @ng-native/migrate@latest, ' +
        'which installs its own.',
    );
  }
  return ts;
}

function scriptKind(ts, file) {
  if (/x$/.test(file)) return ts.ScriptKind.TSX;
  return /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

/**
 * An `import` or `export ... from` statement rewritten as one statement per entry point, or null
 * when it names nothing that moved.
 */
function split(statement, keyword, moves, { elements, typeOnly, defaultName }) {
  const entry = statement.moduleSpecifier.text;
  const stays = [];
  const moved = new Map();
  for (const element of elements) {
    const target = moves[(element.propertyName ?? element.name).text];
    if (target) moved.set(target, [...(moved.get(target) ?? []), element.getText()]);
    else stays.push(element.getText());
  }
  if (!moved.size) return null;
  const quote = statement.moduleSpecifier.getText()[0];
  const end = statement.getText().endsWith(';') ? ';' : '';
  const type = typeOnly ? 'type ' : '';
  const line = (head, names, target) => {
    const bindings = [head, names.length ? `{ ${names.join(', ')} }` : null].filter(Boolean);
    return `${keyword} ${type}${bindings.join(', ')} from ${quote}${target}${quote}${end}`;
  };
  const lines = [];
  if (defaultName || stays.length) lines.push(line(defaultName, stays, entry));
  for (const [target, names] of moved) lines.push(line(null, names, target));
  return lines.join('\n');
}

/** The moves for the entry point an `import` or `export ... from` names, if it is in the table. */
function movesOf(ts, statement, table) {
  if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) return undefined;
  const specifier = statement.moduleSpecifier;
  return specifier && ts.isStringLiteral(specifier) ? table[specifier.text] : undefined;
}

/** What an import becomes: `{ text }` to replace it, `{ note }` when it cannot be split, or null. */
function rewriteImport(ts, statement, moves) {
  const bindings = statement.importClause?.namedBindings;
  if (!bindings) return null;
  if (ts.isNamespaceImport(bindings)) return { note: 'A namespace import' };
  const { isTypeOnly, name } = statement.importClause;
  const text = split(statement, 'import', moves, {
    elements: bindings.elements,
    typeOnly: isTypeOnly,
    defaultName: name?.text,
  });
  return text === null ? null : { text };
}

/** What an `export ... from` becomes, as `rewriteImport` answers. */
function rewriteExport(ts, statement, moves) {
  const clause = statement.exportClause;
  if (!clause || ts.isNamespaceExport(clause)) return { note: 'export *' };
  const text = split(statement, 'export', moves, {
    elements: clause.elements,
    typeOnly: statement.isTypeOnly,
    defaultName: null,
  });
  return text === null ? null : { text };
}

/** `text` with each edit's range replaced, the last first so the earlier offsets still hold. */
function applied(text, edits) {
  let next = text;
  for (const { start, end, text: replacement } of edits.sort((a, b) => b.start - a.start)) {
    next = next.slice(0, start) + replacement + next.slice(end);
  }
  return next;
}

/** Each call that names a moved entry point: `require()`, `import()`, or a mock of it. */
function* namingCalls(ts, node, table) {
  if (ts.isCallExpression(node) && node.arguments.length) {
    const [first] = node.arguments;
    const callee = node.expression;
    const named =
      callee.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(callee) && callee.text === 'require') ||
      (ts.isPropertyAccessExpression(callee) && MOCKS.test(callee.name.text));
    if (named && ts.isStringLiteralLike(first) && table[first.text]) yield node;
  }
  for (const child of node.getChildren()) yield* namingCalls(ts, child, table);
}

/** The edits to a file's top-level imports and exports; each one that cannot be split is noted. */
function statementEdits(ts, source, table, note) {
  const edits = [];
  for (const statement of source.statements) {
    const moves = movesOf(ts, statement, table);
    if (!moves) continue;
    const rewrite = ts.isImportDeclaration(statement) ? rewriteImport : rewriteExport;
    const change = rewrite(ts, statement, moves);
    if (change?.note) note(statement, change.note, statement.moduleSpecifier.text);
    if (change?.text)
      edits.push({ start: statement.getStart(), end: statement.getEnd(), ...change });
  }
  return edits;
}

/**
 * @param {import('./host.cjs').Host} host
 * @param {Table} table
 * @returns {string[]} what is left to change by hand, one line per place
 */
function moveImports(host, table) {
  const ts = typescript();
  const notes = [];
  for (const file of files(host)) {
    const text = SOURCE.test(file) ? host.read(file) : null;
    if (text === null || !Object.keys(table).some((entry) => text.includes(entry))) continue;
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(ts, file),
    );
    const note = (node, what, entry) => {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      notes.push(
        `${file}:${line}: ${what} cannot be split automatically. Import ${where(table[entry])} instead.`,
      );
    };
    const edits = statementEdits(ts, source, table, note);
    for (const call of namingCalls(ts, source, table)) {
      const entry = call.arguments[0].text;
      note(call, `${call.expression.getText()}('${entry}')`, entry);
    }
    if (edits.length) host.write(file, applied(text, edits));
  }
  return notes;
}

module.exports = { moveImports, typescript, scriptKind, applied, SOURCE };
