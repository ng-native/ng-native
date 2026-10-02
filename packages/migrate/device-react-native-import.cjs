/**
 * 0.3.0 stopped exporting `reactNative()` and its `ReactNative` type from `@ng-native/device`. They
 * are how the package reaches React Native without a static import, typed for the few modules it
 * uses, and an app has `react-native` itself to import from. Nothing is rewritten: what an app read
 * through `reactNative()` is a question only it can answer, so each import or re-export of either
 * name is noted.
 */
const { scriptKind, SOURCE, typescript } = require('./move-imports.cjs');
const { files } = require('./host.cjs');

const ENTRY = '@ng-native/device';
const GONE = new Set(['reactNative', 'ReactNative']);

/** The names an import or re-export takes from `@ng-native/device` that it no longer exports. */
function goneFrom(ts, statement) {
  const declaration = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement);
  if (!declaration || statement.moduleSpecifier?.text !== ENTRY) return [];
  const bindings = ts.isImportDeclaration(statement)
    ? statement.importClause?.namedBindings
    : statement.exportClause;
  const named =
    bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))
      ? bindings.elements
      : [];
  return named
    .map((element) => (element.propertyName ?? element.name).text)
    .filter((name) => GONE.has(name));
}

/** Whether a file can import either name at all, before it is parsed. */
const mentions = (text) =>
  text !== null && text.includes(ENTRY) && /\breactNative\b|\bReactNative\b/.test(text);

/** @param {import('./host.cjs').Host} host */
function deviceReactNativeImport(host) {
  const ts = typescript();
  const notes = [];
  for (const file of files(host)) {
    const text = SOURCE.test(file) ? host.read(file) : null;
    if (!mentions(text)) continue;
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(ts, file),
    );
    for (const statement of source.statements) {
      const gone = goneFrom(ts, statement);
      if (!gone.length) continue;
      const line = source.getLineAndCharacterOfPosition(statement.getStart()).line + 1;
      const what = gone.length === 1 ? `${gone[0]} is` : `${gone.join(' and ')} are`;
      notes.push(
        `${file}:${line}: ${what} no longer exported from '${ENTRY}'. ` +
          "Import what you use from 'react-native' directly.",
      );
    }
  }
  return notes;
}

module.exports = { deviceReactNativeImport };
