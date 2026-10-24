/**
 * `watchConditions(app.engine)` returns a function that stops watching the device's size, colour
 * scheme and other conditions, and an app's `main.ts` dropped it: when Android recreates the
 * activity, the old app's watch kept running beside the new one's. The template and generators
 * now keep it and stop it as the app is destroyed.
 *
 * In each file that imports `watchConditions` from `@ng-native/device`, a call to it that is a
 * statement of its own, whose engine is read off a named app (`app.engine`), becomes the same two
 * lines: the call kept in `stopWatching`, and `app.applicationRef.onDestroy(stopWatching)`. A call
 * whose result is already used is left alone. One given an engine with no app to read it off, or
 * in a scope that already has a `stopWatching`, is noted rather than changed.
 */
const { applied, scriptKind, SOURCE, typescript } = require('./move-imports.cjs');
const { files } = require('./host.cjs');

const ENTRY = '@ng-native/device';
const NAME = 'stopWatching';

/** The local names `watchConditions` is imported as. */
function imported(ts, source) {
  const names = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== ENTRY) continue;
    const bindings = statement.importClause?.namedBindings;
    for (const element of bindings && ts.isNamedImports(bindings) ? bindings.elements : []) {
      const name = (element.propertyName ?? element.name).text;
      if (name === 'watchConditions') names.add(element.name.text);
    }
  }
  return names;
}

/** The note for a call this migration cannot rewrite. */
function note(file, source, call) {
  const line = source.getLineAndCharacterOfPosition(call.getStart()).line + 1;
  return (
    `${file}:${line}: ${call.getText()} returns a function that stops watching. ` +
    'Keep it and call it as the app is destroyed: app.applicationRef.onDestroy(stop).'
  );
}

/** Each bare `watchConditions(x.engine, ...)` statement as an edit, and a note for the rest. */
function rewrite(ts, file, source, names, notes) {
  const text = source.text;
  const edits = [];
  const visit = (node) => {
    const call = ts.isExpressionStatement(node) && node.expression;
    if (
      call &&
      ts.isCallExpression(call) &&
      ts.isIdentifier(call.expression) &&
      names.has(call.expression.text)
    ) {
      const [engine] = call.arguments;
      const app =
        engine &&
        ts.isPropertyAccessExpression(engine) &&
        engine.name.text === 'engine' &&
        ts.isIdentifier(engine.expression) &&
        engine.expression.text;
      // ponytail: a stopWatching anywhere in the file counts as taken, rather than resolving scope.
      if (!app || new RegExp(`\\b${NAME}\\b`).test(text)) notes.push(note(file, source, call));
      else {
        const line = text.lastIndexOf('\n', node.getStart()) + 1;
        const indent = text.slice(line, node.getStart());
        edits.push({
          start: node.getStart(),
          end: node.getEnd(),
          text: `const ${NAME} = ${call.getText()};\n${indent}${app}.applicationRef.onDestroy(${NAME});`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edits;
}

/** @param {import('./host.cjs').Host} host */
function stopWatchingConditions(host) {
  const ts = typescript();
  const notes = [];
  for (const file of files(host)) {
    const text = SOURCE.test(file) ? host.read(file) : null;
    if (text === null || !text.includes(ENTRY) || !text.includes('watchConditions')) continue;
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(ts, file),
    );
    const names = imported(ts, source);
    if (!names.size) continue;
    const edits = rewrite(ts, file, source, names, notes);
    if (edits.length) host.write(file, applied(text, edits));
  }
  return notes;
}

module.exports = { stopWatchingConditions };
