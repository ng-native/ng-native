/**
 * 0.23.0 makes every service's `available` a `Signal<boolean>`, read as `available()`. It used to
 * come in five shapes:
 *
 * - a property, read as `x.available`: `DevMenu`, `Haptics`, `SplashScreen`, `Tracking`, `Fonts` and
 *   `Watch`. Each read is rewritten to `x.available()`.
 * - a method that resolved, read as `await x.available()`: `Biometrics`, `AppleSignIn`,
 *   `ScreenCapture` and `StoreReview`. Each `await x.available()` is rewritten to `x.available()`;
 *   any other use of the promise, such as `.then(...)`, is noted.
 * - a signal of `boolean | null`, the sensors': a comparison of `x.available()` with `null` or
 *   `undefined`, or a `??` after it, is noted, since it is never null now.
 *
 * What a member is read from is followed as `tracking-available-getter` follows it: `inject(X)`
 * itself, `this.` a member of the enclosing class that holds one, or a name whose nearest
 * declaration holds one, where holding one means initialised with `inject(X)` or typed `X`.
 * `splashScreen`, the instance the splash screen entry exports, is one too. A component's
 * template, inline or in the file its `templateUrl` names, reads that component's own members,
 * so a property read there is rewritten for those alone. A namespace import is noted.
 */
const { applied, scriptKind, SOURCE, typescript } = require('./move-imports.cjs');
const { files } = require('./host.cjs');
const { ELSE, isStatic, nearestBinding, thisOf } = require('./scope.cjs');

/**
 * Each service by its entry point: the names it is injected or typed as, instances an entry
 * exports, and the shape its `available` had.
 */
const SERVICES = [
  { entry: '@ng-native/device', names: ['DevMenu'], shape: 'property' },
  { entry: '@ng-native/expo/haptics', names: ['Haptics'], shape: 'property' },
  { entry: '@ng-native/expo/tracking', names: ['Tracking'], shape: 'property' },
  { entry: '@ng-native/expo/fonts', names: ['Fonts', 'FontRegistry'], shape: 'property' },
  {
    entry: '@ng-native/expo/splash-screen',
    names: ['SplashScreen', 'Splash'],
    instances: ['splashScreen'],
    shape: 'property',
  },
  { entry: '@ng-native/expo/watch', names: ['Watch'], shape: 'property' },
  { entry: '@ng-native/expo/biometrics', names: ['Biometrics'], shape: 'promise' },
  { entry: '@ng-native/expo/apple-sign-in', names: ['AppleSignIn'], shape: 'promise' },
  { entry: '@ng-native/expo/screen-capture', names: ['ScreenCapture'], shape: 'promise' },
  { entry: '@ng-native/expo/store-review', names: ['StoreReview'], shape: 'promise' },
  {
    entry: '@ng-native/expo/sensors',
    names: [
      'Accelerometer',
      'Gyroscope',
      'Magnetometer',
      'DeviceMotion',
      'Barometer',
      'LightSensor',
      'Sensor',
    ],
    shape: 'nullable',
  },
];

const ENTRIES = new Set(SERVICES.map((service) => service.entry));

/**
 * The local names each shape's services are imported as, the instances imported, and the
 * namespace imports of an entry point that holds one.
 */
function imported(ts, source) {
  const found = {
    types: { property: new Set(), promise: new Set(), nullable: new Set() },
    instances: new Set(),
    namespaces: [],
  };
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const entry = statement.moduleSpecifier.text;
    const services = SERVICES.filter((service) => service.entry === entry);
    if (!services.length) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) found.namespaces.push([statement, entry]);
    for (const element of bindings && ts.isNamedImports(bindings) ? bindings.elements : []) {
      importedName(element, services, found);
    }
  }
  return found;
}

/** Files one named import under each service it names, by shape, or as an instance. */
function importedName(element, services, { types, instances }) {
  const name = (element.propertyName ?? element.name).text;
  for (const service of services) {
    if (service.names.includes(name)) types[service.shape].add(element.name.text);
    if (service.instances?.includes(name)) instances.add(element.name.text);
  }
}

/** Whether `node` is `inject(X)` for an `X` in `types`. */
const isInjected = (ts, node, types) =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'inject' &&
  node.arguments.length >= 1 &&
  ts.isIdentifier(node.arguments[0]) &&
  types.has(node.arguments[0].text);

/** Whether a variable, property or parameter holds one of `types`. */
function holds(ts, declaration, types) {
  const { type, initializer } = declaration;
  if (type && ts.isTypeReferenceNode(type) && types.has(type.typeName.getText())) return true;
  return Boolean(initializer && isInjected(ts, initializer, types));
}

/** The members of a class that hold one of `types`, apart by instance and static. */
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

/** Whether `receiver` is one of `types`, or one of `instances`, as this file can tell. */
function isHolder(ts, receiver, types, instances) {
  if (isInjected(ts, receiver, types)) return true;
  if (ts.isIdentifier(receiver)) {
    const declaration = nearestBinding(ts, receiver);
    if (!declaration) return instances.has(receiver.text);
    return declaration !== ELSE && holds(ts, declaration, types);
  }
  if (!ts.isPropertyAccessExpression(receiver)) return false;
  if (receiver.expression.kind !== ts.SyntaxKind.ThisKeyword) return false;
  const self = thisOf(ts, receiver);
  if (!self) return false;
  const names = classHolders(ts, self.cls, types);
  return (self.static ? names.static : names.instance).has(receiver.name.text);
}

/** Whether `node` reads a member named `available`, as `x.available` or `x['available']`. */
const readsAvailable = (ts, node) =>
  (ts.isPropertyAccessExpression(node) && node.name.text === 'available') ||
  (ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === 'available');

/** The expression a member is read from, for either way of reading it. */
const receiverOf = (node) => node.expression;

/** Whether `call` is used as a promise still: chained with then, catch or finally, or in Promise.all. */
function usedAsPromise(ts, call) {
  const around = outside(ts, call);
  const parent = around.parent;
  if (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === around &&
    ['then', 'catch', 'finally'].includes(parent.name.text)
  ) {
    return true;
  }
  const list = ts.isArrayLiteralExpression(parent) ? parent.parent : parent;
  return (
    ts.isCallExpression(list) &&
    ts.isPropertyAccessExpression(list.expression) &&
    ts.isIdentifier(list.expression.expression) &&
    list.expression.expression.text === 'Promise' &&
    ['all', 'allSettled', 'race', 'any'].includes(list.expression.name.text)
  );
}

/** Skips the parentheses around an expression, outwards. */
function outside(ts, node) {
  let at = node;
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
  return at;
}

/** Whether `node` is `null` or `undefined`. */
const isNullish = (ts, node) =>
  node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === 'undefined');

const NULL_CHECKS = new Set(['===', '==', '!==', '!=', '??']);

/** The edits to a file's code, and the notes for what it leaves to the developer. */
function codeEdits(ts, source, file, { types, instances }) {
  const edits = [];
  const notes = [];
  const line = (node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const visit = (node) => {
    if (readsAvailable(ts, node)) {
      const call = ts.isCallExpression(node.parent) && node.parent.expression === node;
      if (!call && isHolder(ts, receiverOf(node), types.property, instances)) {
        edits.push({ start: node.getEnd(), end: node.getEnd(), text: '()' });
      }
      if (call && node.parent.arguments.length === 0) {
        promised(node.parent, receiverOf(node));
        nullable(node.parent, receiverOf(node));
      }
    }
    ts.forEachChild(node, visit);
  };
  const promised = (call, receiver) => {
    if (!isHolder(ts, receiver, types.promise, instances)) return;
    const around = outside(ts, call);
    if (ts.isAwaitExpression(around.parent)) {
      const awaited = around.parent;
      edits.push({ start: awaited.getStart(), end: awaited.expression.getStart(), text: '' });
      return;
    }
    // Only a call still used as a promise: one that is read as a signal is already migrated.
    if (!usedAsPromise(ts, call)) return;
    notes.push(
      `${file}:${line(call)}: available() is a signal now, not a promise. ` +
        'Read it as available(), without awaiting it or calling then().',
    );
  };
  const nullable = (call, receiver) => {
    if (!isHolder(ts, receiver, types.nullable, instances)) return;
    const around = outside(ts, call);
    const parent = around.parent;
    if (!ts.isBinaryExpression(parent)) return;
    const operator = parent.operatorToken.getText();
    const other = parent.left === around ? parent.right : parent.left;
    if (operator === '??' || (NULL_CHECKS.has(operator) && isNullish(ts, other))) {
      notes.push(
        `${file}:${line(call)}: A sensor's available() is never null now: it is false until ` +
          'the platform answers.',
      );
    }
  };
  visit(source);
  return { edits, notes };
}

/**
 * A template declaring `name` itself: `@let`, a `@for` or `*ngFor` item or `let` alias, a `#`
 * reference, an `as` alias, or an `ng-template`'s `let-`.
 */
const declaration = (name) =>
  new RegExp(
    `@let\\s+${name}\\b|\\blet[\\s-]+${name}\\b|#${name}\\b|\\bas\\s+${name}\\b|@for\\s*\\(\\s*${name}\\s+of\\b`,
  );

/** A property read of `name.available`, not already called. */
const propertyRead = (name) =>
  new RegExp(`\\b${name}(?:\\.available\\b|\\[\\s*['"]available['"]\\s*\\])(?!\\s*\\()`, 'g');

/** A template with each holder's `.available` called, and the names it left as declared there. */
function inTemplate(text, names) {
  let next = text;
  const left = [];
  for (const name of new Set(names)) {
    if (declaration(name).test(text)) {
      if (propertyRead(name).test(text)) left.push(name);
      continue;
    }
    next = next.replace(propertyRead(name), (read) => `${read}()`);
  }
  return { text: next, left };
}

const declarationLine = (text, name) =>
  text.slice(0, text.search(declaration(name))).split('\n').length;

const localNote = (where, name) =>
  `${where}: The template declares a ${name} of its own, so it was left as it is. ` +
  `Where it reads the component's service, call ${name}.available().`;

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

/** One component's inline template as an edit, and the template file it names, with its holders. */
function componentTemplate(ts, source, file, metadata, names, dir, found) {
  for (const property of metadata.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
    const value = property.initializer;
    if (!ts.isStringLiteralLike(value)) continue;
    if (property.name.text === 'templateUrl') found.urls.push([normalise(dir + value.text), names]);
    if (property.name.text !== 'template') continue;
    const { text, left } = inTemplate(value.getText(), names);
    const at = source.getLineAndCharacterOfPosition(property.getStart()).line + 1;
    for (const name of left) found.notes.push(localNote(`${file}:${at}`, name));
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

/** Rewrites one source file, and answers the template files it names, each with its holders. */
function rewriteSource(ts, host, file, text, notes) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(ts, file),
  );
  const found = imported(ts, source);
  for (const [statement, entry] of found.namespaces) {
    const at = source.getLineAndCharacterOfPosition(statement.getStart()).line + 1;
    notes.push(
      `${file}:${at}: A namespace import of '${entry}' cannot be followed automatically. ` +
        "A service's available is a signal now: read it as available(), and do not await it.",
    );
  }
  const { types } = found;
  if (
    !types.property.size &&
    !types.promise.size &&
    !types.nullable.size &&
    !found.instances.size
  ) {
    return [];
  }
  const code = codeEdits(ts, source, file, found);
  const view = templates(ts, source, file, types.property);
  notes.push(...view.notes, ...code.notes);
  const edits = [...view.edits, ...code.edits];
  if (edits.length) host.write(file, applied(text, edits));
  return view.urls;
}

/** @param {import('./host.cjs').Host} host */
function availableSignal(host) {
  const ts = typescript();
  const notes = [];
  const named = new Map();
  for (const file of files(host)) {
    const text = SOURCE.test(file) ? host.read(file) : null;
    if (text === null || ![...ENTRIES].some((entry) => text.includes(entry))) continue;
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

module.exports = { availableSignal };
