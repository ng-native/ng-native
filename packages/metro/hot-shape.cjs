/**
 * What of a file a hot patch can and cannot apply to the app that is running, read with a parser.
 *
 * A patch gives the running app the file's edited behaviour: a class's methods go onto the class
 * every other module holds, and an exported function replaces the one they call. What it cannot
 * do is run again anything that already ran, so two parts of the file are compared from one save
 * to the next, and a change to either reloads instead:
 *
 * - `construction`, by class: its fields and its constructor, which run when an instance is made.
 *   An edit there would reach the instances made after it and none of the ones in use. Static
 *   fields are left out: a patch copies them.
 * - `init`: everything the module runs when it loads that is neither an import, a type, a
 *   function, nor one of the classes being patched. A constant, a route table or a token has been
 *   read by whoever imported it, and nothing reads it again. A function the module calls while it
 *   loads is part of that, and so is every function when one is: its result has been read too.
 *
 * `functions` are the file's own, each with the names it is exported by and whether it is
 * `declared`, a `function` whose binding can be given another value, or a constant that cannot.
 * `constants` are the second kind as written: a class that names one as it builds an instance
 * holds the function from before an edit to it.
 * `decorators` are each class's, to tell an edit to what it renders from one to what it does.
 */
const { parse } = require('@babel/parser');
const { nodes, pluginsFor } = require('./component-declarations.cjs');

const BUILDS = new Set(['ClassProperty', 'ClassPrivateProperty', 'ClassAccessorProperty']);
const TYPES = new Set(['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSDeclareFunction']);
const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression']);

/** Whether a declaration is a function, or constants that are each one. */
function isFunction(node) {
  if (node.type === 'FunctionDeclaration') return true;
  return (
    node.type === 'VariableDeclaration' &&
    node.declarations.every((one) => one.id.type === 'Identifier' && FUNCTIONS.has(one.init?.type))
  );
}

const namesOf = (node) =>
  node.type === 'FunctionDeclaration'
    ? [node.id?.name].filter(Boolean)
    : node.declarations.map((one) => one.id.name);

/**
 * Each class by its name: `construction`, its fields and constructor as written, and
 * `decorators`, which are what its definition is compiled from.
 */
function classesOf(program, text) {
  const construction = new Map();
  const decorators = new Map();
  for (const node of nodes(program)) {
    if (node.type !== 'ClassDeclaration' || !node.id) continue;
    decorators.set(node.id.name, (node.decorators ?? []).map(text).join('\n'));
    const built = node.body.body.filter(
      (member) => (BUILDS.has(member.type) && !member.static) || member.kind === 'constructor',
    );
    const parent = node.superClass ? text(node.superClass) : '';
    construction.set(node.id.name, [parent, ...built.map(text)].join('\n'));
  }
  return { construction, decorators };
}

const unwrap = (statement) =>
  (/^Export(Named|Default)Declaration$/.test(statement.type) && statement.declaration) || statement;

/** Whether a statement runs nothing a patch has to answer for. */
function isInert(statement, node, patched) {
  if (node.type === 'ImportDeclaration' || TYPES.has(node.type) || node.declare) return true;
  if (statement.exportKind === 'type') return true;
  return node.type === 'ClassDeclaration' && patched.includes(node.id?.name);
}

/**
 * What one statement adds: text the module ran as it loaded, or functions it exports. `local` are
 * the names of the file's functions.
 */
function read(statement, text, local) {
  const node = unwrap(statement);
  if (node.type === 'ExportNamedDeclaration' && !node.source) {
    // `export { format }` hands over a function declared elsewhere in the file.
    const handed = node.specifiers.filter((one) => local.includes(one.local.name));
    return {
      functions: handed.map((one) => ({ exported: one.exported.name, local: one.local.name })),
      init: handed.length < node.specifiers.length ? text(statement) : '',
    };
  }
  if (!isFunction(node)) return { functions: [], init: text(statement) };
  if (statement.type === 'ExportDefaultDeclaration') {
    // An anonymous default has no binding to hand over, so it is part of what loading ran.
    return node.id
      ? { functions: [{ exported: 'default', local: node.id.name }], init: '' }
      : { functions: [], init: text(statement) };
  }
  const names = statement === node ? [] : namesOf(node);
  return { functions: names.map((name) => ({ exported: name, local: name })), init: '' };
}

const KEYED = new Set(['ObjectProperty', 'ObjectMethod', 'ClassProperty', 'ClassMethod']);
const MEMBER = new Set(['MemberExpression', 'OptionalMemberExpression']);

/**
 * Whether a statement names one of `local`, the file's functions, as a value: a call, or the
 * function handed somewhere. Not as a key, `{ price: 1 }`, nor a member, `item.price`, which are
 * other things by the same name.
 */
function names(statement, local) {
  const others = new Set();
  for (const node of nodes(statement)) {
    if (KEYED.has(node.type) && !node.computed && !node.shorthand) others.add(node.key);
    if (MEMBER.has(node.type) && !node.computed) others.add(node.property);
  }
  for (const node of nodes(statement)) {
    if (node.type === 'Identifier' && local.includes(node.name) && !others.has(node)) return true;
  }
  return false;
}

/**
 * @param {string[]} patched the classes a patch carries, which answer for themselves
 * @returns {{ construction: Map<string, string>, decorators: Map<string, string>, init: string,
 *   functions: { local: string, exported: string[], declared: boolean }[],
 *   constants: Map<string, string> } | null} null for a file that does not parse
 */
function hotShape(code, filename, patched) {
  let program;
  try {
    program = parse(code, { sourceType: 'module', plugins: pluginsFor(filename) }).program;
  } catch {
    return null;
  }
  const text = (node) => code.slice(node.start, node.end);
  const local = program.body.map(unwrap).filter(isFunction).flatMap(namesOf);
  const parts = program.body
    .filter((statement) => !isInert(statement, unwrap(statement), patched))
    .map((statement) => ({ statement, ...read(statement, text, local) }));
  const ran = parts.filter((part) => part.init);
  const called = ran.some((part) => names(part.statement, local));
  const exported = parts.flatMap((part) => part.functions);
  const declared = program.body.map(unwrap).filter((node) => node.type === 'FunctionDeclaration');
  const constants = new Map(
    program.body
      .map(unwrap)
      .filter((node) => isFunction(node) && node.type !== 'FunctionDeclaration')
      .flatMap((node) => namesOf(node).map((name) => [name, text(node)])),
  );
  return {
    ...classesOf(program, text),
    init: called ? code : ran.map((part) => part.init).join('\n'),
    functions: local.map((name) => ({
      local: name,
      exported: exported.filter((one) => one.local === name).map((one) => one.exported),
      declared: declared.some((node) => node.id?.name === name),
    })),
    constants,
  };
}

module.exports = { hotShape };
