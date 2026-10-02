/**
 * 0.3.0 made `Tracking`'s `available` a getter, as `Haptics`, `Fonts` and `SplashScreen` have it:
 * the answer is known at once and never changes. A call to it is now a call to a boolean.
 *
 * In each file that imports `Tracking` from `@ng-native/expo/tracking`, a `.available()` is
 * rewritten to `.available` where what it is read from is known to be a `Tracking`: `inject(Tracking)`
 * itself, `this.` a member of the enclosing class that holds one, or a name whose nearest
 * declaration holds one. Holding one means initialised with `inject(Tracking)` or typed `Tracking`.
 * A component's template, inline or in the file its `templateUrl` names, reads that component's own
 * members, so it is rewritten for those alone. `.available()` on anything else is left alone, so
 * another service's `available()` keeps its call. A namespace import is noted rather than followed.
 */
const { applied, scriptKind, SOURCE, typescript } = require('./move-imports.cjs');
const { files } = require('./host.cjs');

const ENTRY = '@ng-native/expo/tracking';

/** The local names `Tracking` is imported as, and the namespace import, if the file has one. */
function imported(ts, source) {
  const types = new Set();
  let namespace = null;
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== ENTRY) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespace = statement;
    for (const element of bindings && ts.isNamedImports(bindings) ? bindings.elements : []) {
      if ((element.propertyName ?? element.name).text === 'Tracking') types.add(element.name.text);
    }
  }
  return { types, namespace };
}

/** Whether `node` is `inject(Tracking)`. */
const isInjected = (ts, node, types) =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'inject' &&
  node.arguments.length === 1 &&
  ts.isIdentifier(node.arguments[0]) &&
  types.has(node.arguments[0].text);

/** Whether a variable, property or parameter holds a `Tracking`. */
function holds(ts, declaration, types) {
  const { type, initializer } = declaration;
  if (type && ts.isTypeReferenceNode(type) && types.has(type.typeName.getText())) return true;
  return Boolean(initializer && isInjected(ts, initializer, types));
}

const isStatic = (ts, node) =>
  Boolean(ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword));

/**
 * The members of a class that hold a `Tracking`, apart by whether `this` reaches them from an
 * instance or from the class itself: properties, and constructor parameter properties.
 */
function classHolders(ts, cls, types) {
  const names = { instance: new Set(), static: new Set() };
  for (const member of cls.members) {
    if (
      ts.isPropertyDeclaration(member) &&
      ts.isIdentifier(member.name) &&
      holds(ts, member, types)
    ) {
      names[isStatic(ts, member) ? 'static' : 'instance'].add(member.name.text);
    }
    if (!ts.isConstructorDeclaration(member)) continue;
    for (const parameter of member.parameters) {
      const property = ts.getModifiers(parameter)?.length && ts.isIdentifier(parameter.name);
      if (property && holds(ts, parameter, types)) names.instance.add(parameter.name.text);
    }
  }
  return names;
}

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
 * catch binding, a function or class), which is never a `Tracking` this can tell.
 */
function declaredIn(ts, node, name) {
  if (ts.isFunctionLike(node)) return inFunction(ts, node, name);
  if (isLoop(ts, node)) return inLoop(ts, node, name);
  if (ts.isCatchClause(node)) return inCatch(ts, node, name);
  return isBlock(ts, node) ? inStatements(ts, node.statements, name) : undefined;
}

/** Whether the nearest binding of the name `identifier` reads holds a `Tracking`. */
function identifierHolds(ts, identifier, types) {
  for (let at = identifier.parent; at; at = at.parent) {
    const declaration = declaredIn(ts, at, identifier.text);
    if (declaration === ELSE) return false;
    if (declaration) return holds(ts, declaration, types);
  }
  return false;
}

/** Whether `receiver` is a `Tracking`, as this file can tell. */
function isTracking(ts, receiver, types) {
  if (isInjected(ts, receiver, types)) return true;
  if (ts.isIdentifier(receiver)) return identifierHolds(ts, receiver, types);
  if (!ts.isPropertyAccessExpression(receiver)) return false;
  if (receiver.expression.kind !== ts.SyntaxKind.ThisKeyword) return false;
  const self = thisOf(ts, receiver);
  if (!self) return false;
  const names = classHolders(ts, self.cls, types);
  return (self.static ? names.static : names.instance).has(receiver.name.text);
}

/** Each `x.available()` in the code whose `x` is a `Tracking`, as an edit dropping the call. */
function codeEdits(ts, source, types) {
  const edits = [];
  const visit = (node) => {
    const callee = ts.isCallExpression(node) && node.arguments.length === 0 && node.expression;
    const target =
      callee && ts.isPropertyAccessExpression(callee) && callee.name.text === 'available';
    if (target && isTracking(ts, callee.expression, types)) {
      edits.push({ start: callee.getEnd(), end: node.getEnd(), text: '' });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edits;
}

/**
 * A template declaring `name` itself: `@let`, a `@for` or `*ngFor` item or `let` alias, a
 * `#` reference, an `as` alias, or an `ng-template`'s `let-`. Such a name may be something other
 * than the component's member wherever it is in scope.
 */
const declaration = (name) =>
  new RegExp(
    `@let\\s+${name}\\b|\\blet[\\s-]+${name}\\b|#${name}\\b|\\bas\\s+${name}\\b|@for\\s*\\(\\s*${name}\\s+of\\b`,
  );
const declares = (text, name) => declaration(name).test(text);

/**
 * A template with `name.available()` read as a property, for each name that holds a `Tracking` and
 * that the template does not declare for itself, and the names it left for that reason.
 */
function inTemplate(text, names) {
  let next = text;
  const left = [];
  for (const name of new Set(names)) {
    if (declares(text, name)) {
      if (new RegExp(`\\b${name}\\.available\\(\\s*\\)`).test(text)) left.push(name);
      continue;
    }
    next = next.replace(new RegExp(`\\b${name}\\.available\\(\\s*\\)`, 'g'), `${name}.available`);
  }
  return { text: next, left };
}

/** The line of a template file where it first declares `name` for itself. */
const declarationLine = (text, name) =>
  text.slice(0, text.search(declaration(name))).split('\n').length;

/** The note for a name a template declares for itself, which it leaves to the developer. */
const localNote = (where, name) =>
  `${where}: The template declares a ${name} of its own, so it was left as it is. ` +
  `Where it reads the component's Tracking, read ${name}.available without calling it.`;

/** The object literal a class's `@Component(...)` decorator is given, if it has one. */
function componentMetadata(ts, cls, components) {
  for (const decorator of ts.getDecorators(cls) ?? []) {
    const call = decorator.expression;
    if (!ts.isCallExpression(call) || !components.has(call.expression.getText())) continue;
    const [metadata] = call.arguments;
    if (metadata && ts.isObjectLiteralExpression(metadata)) return metadata;
  }
  return null;
}

/** A workspace path with `./` and `../` resolved. */
function normalise(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.join('/');
}

/** The names `Component` is imported from `@angular/core` as. */
function componentNames(ts, source) {
  const names = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== '@angular/core') {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    for (const element of bindings && ts.isNamedImports(bindings) ? bindings.elements : []) {
      if ((element.propertyName ?? element.name).text === 'Component') names.add(element.name.text);
    }
  }
  return names;
}

/** One component's inline template as an edit, and the template file it names, with its holders. */
function componentTemplate(ts, source, file, metadata, names, dir, found) {
  for (const property of metadata.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
    const value = property.initializer;
    if (!ts.isStringLiteralLike(value)) continue;
    if (property.name.text === 'templateUrl') found.urls.push([normalise(dir + value.text), names]);
    if (property.name.text !== 'template') continue;
    const { text, left } = inTemplate(value.getText(), names);
    const line = source.getLineAndCharacterOfPosition(property.getStart()).line + 1;
    for (const name of left) found.notes.push(localNote(`${file}:${line}`, name));
    if (text !== value.getText()) {
      found.edits.push({ start: value.getStart(), end: value.getEnd(), text });
    }
  }
}

/** Each component's inline template edits, and the template files it names, with its holders. */
function templates(ts, source, file, types) {
  const found = { edits: [], urls: [], notes: [] };
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
  const components = componentNames(ts, source);
  const visit = (node) => {
    const cls = ts.isClassDeclaration(node) || ts.isClassExpression(node);
    const metadata = cls && componentMetadata(ts, node, components);
    // A template reads the instance's members.
    const names = metadata ? classHolders(ts, node, types).instance : null;
    if (names?.size) componentTemplate(ts, source, file, metadata, names, dir, found);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The note for a namespace import, whose names cannot be followed through. */
function namespaceNote(file, source, statement) {
  const line = source.getLineAndCharacterOfPosition(statement.getStart()).line + 1;
  return (
    `${file}:${line}: A namespace import of '${ENTRY}' cannot be followed automatically. ` +
    "Tracking's available is now a property: read it as tracking.available, without calling it."
  );
}

/** Rewrites one source file, and answers the template files it names, each with its holders. */
function rewriteSource(ts, host, file, text, notes) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(ts, file),
  );
  const { types, namespace } = imported(ts, source);
  if (namespace) notes.push(namespaceNote(file, source, namespace));
  if (!types.size) return [];
  const { edits, urls, notes: local } = templates(ts, source, file, types);
  notes.push(...local);
  edits.push(...codeEdits(ts, source, types));
  if (edits.length) host.write(file, applied(text, edits));
  return urls;
}

/** @param {import('./host.cjs').Host} host */
function trackingAvailableGetter(host) {
  const ts = typescript();
  const notes = [];
  const named = new Map();
  for (const file of files(host)) {
    const text = SOURCE.test(file) ? host.read(file) : null;
    if (text === null || !text.includes(ENTRY)) continue;
    for (const [url, names] of rewriteSource(ts, host, file, text, notes)) {
      named.set(url, [...(named.get(url) ?? []), ...names]);
    }
  }
  for (const [url, names] of named) {
    const text = host.read(url);
    if (text === null) continue;
    const { text: next, left } = inTemplate(text, names);
    for (const name of left) notes.push(localNote(`${url}:${declarationLine(text, name)}`, name));
    if (next !== text) host.write(url, next);
  }
  return notes;
}

module.exports = { trackingAvailableGetter };
