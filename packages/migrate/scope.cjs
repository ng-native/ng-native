/**
 * What a name or a `this` refers to at a point in a file, read from the syntax alone: the nearest
 * declaration of the name in the scopes around it, and the class whose instance (or the class
 * itself) `this` is. A migration that rewrites a member only where it can tell what it is read
 * from builds on these; one that cannot tell leaves the code alone.
 */
const isStatic = (ts, node) =>
  Boolean(ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword));

/** A class member whose own `this` is the class's: a method, accessor, constructor or field. */
const isMember = (ts, node) =>
  (ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent)) &&
  (ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isClassStaticBlockDeclaration(node));

/**
 * The class `this` is in at `node`, and whether it is the class itself rather than an instance, or
 * null where `this` is something else: inside a plain function or an object literal's method, which
 * bind a `this` of their own. An arrow function keeps the `this` around it.
 */
function thisOf(ts, node) {
  for (let at = node.parent; at; at = at.parent) {
    if (isMember(ts, at)) {
      return { cls: at.parent, static: ts.isClassStaticBlockDeclaration(at) || isStatic(ts, at) };
    }
    if (ts.isFunctionLike(at) && !ts.isArrowFunction(at)) return null;
  }
  return null;
}

/** What a binding of a name is when only its shape is known: a pattern, a catch, a function. */
const ELSE = Symbol('something else');

/** Whether a binding name, or any name inside a destructuring pattern, is `name`. */
function binds(ts, nameNode, name) {
  if (ts.isIdentifier(nameNode)) return nameNode.text === name;
  return nameNode.elements.some(
    (element) => !ts.isOmittedExpression(element) && binds(ts, element.name, name),
  );
}

/** A variable or parameter binding `name`: itself if bound plainly, `ELSE` if destructured. */
const bound = (ts, declaration, name) => (ts.isIdentifier(declaration.name) ? declaration : ELSE);

/** The bindings of `name` a list of variable declarations makes, as `bound` answers. */
function inDeclarations(ts, list, name) {
  const found = list.declarations.find((d) => binds(ts, d.name, name));
  return found && bound(ts, found);
}

/** The bindings of `name` a block's statements make: variables, and functions and classes. */
function inStatements(ts, statements, name) {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      const found = inDeclarations(ts, statement.declarationList, name);
      if (found) return found;
    }
    const named = ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement);
    if (named && statement.name?.text === name) return ELSE;
  }
  return undefined;
}

/** A function's own name, if it is an expression's, and its parameters. */
function inFunction(ts, node, name) {
  if (ts.isFunctionExpression(node) && node.name?.text === name) return ELSE;
  const parameter = node.parameters.find((p) => binds(ts, p.name, name));
  return parameter && bound(ts, parameter);
}

/** A `for`, `for...of` or `for...in` loop's own variables. */
function inLoop(ts, node, name) {
  const { initializer } = node;
  if (!initializer || !ts.isVariableDeclarationList(initializer)) return undefined;
  return inDeclarations(ts, initializer, name);
}

/** A `catch` clause's binding. */
const inCatch = (ts, node, name) =>
  node.variableDeclaration && binds(ts, node.variableDeclaration.name, name) ? ELSE : undefined;

const isLoop = (ts, node) =>
  ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node);

const isBlock = (ts, node) => ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node);

/**
 * The binding of `name` the scope `node` opens, if it makes one there: the declaration when it is a
 * plain variable or parameter, `ELSE` for one only its shape is known of (a destructured name, a
 * catch binding, a function or class), whose type the syntax does not give.
 */
function declaredIn(ts, node, name) {
  if (ts.isFunctionLike(node)) return inFunction(ts, node, name);
  if (isLoop(ts, node)) return inLoop(ts, node, name);
  if (ts.isCatchClause(node)) return inCatch(ts, node, name);
  return isBlock(ts, node) ? inStatements(ts, node.statements, name) : undefined;
}

/**
 * The nearest binding of the name `identifier` reads: its declaration when it is a plain variable
 * or parameter, `ELSE` when only its shape is known, and undefined when no scope in the file
 * declares it, as for an import or a global.
 */
function nearestBinding(ts, identifier) {
  for (let at = identifier.parent; at; at = at.parent) {
    const declaration = declaredIn(ts, at, identifier.text);
    if (declaration) return declaration;
  }
  return undefined;
}

module.exports = { ELSE, isStatic, nearestBinding, thisOf };
