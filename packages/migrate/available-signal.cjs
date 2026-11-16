/**
 * 0.23.0 makes every service's `available` a `Signal<boolean>`, read as `available()`. It used to
 * come in five shapes:
 *
 * - a property, read as `x.available`: `DevMenu`, `Haptics`, `SplashScreen`, `Tracking`, `Fonts` and
 *   `Watch`. Each read is rewritten to `x.available()`.
 * - a method that resolved, read as `await x.available()`: `Biometrics`, `AppleSignIn`,
 *   `ScreenCapture` and `StoreReview`. Each `await x.available()` is rewritten to `x.available()`
 *   and noted, since the signal is false until the platform answers, where the await waited for
 *   it; any other use of the promise, such as `.then(...)`, is noted.
 * - a signal of `boolean | null`, the sensors': a comparison of `x.available()` with `null` or
 *   `undefined`, or a `??` after it, is noted, since it is never null now.
 *
 * What a member is read from is followed as `tracking-available-getter` follows it: `inject(X)`
 * itself, `this.` a member of the enclosing class that holds one, or a name whose nearest
 * declaration holds one, where holding one means initialised with `inject(X)`, `X` being the
 * import rather than a name that shadows it, or typed `X`. `splashScreen`, the instance the splash
 * screen entry exports, is one too. A component's template, inline or in the file its
 * `templateUrl` names, reads that component's own members, so a property read there is rewritten
 * for those alone, and not where the name is read off something else (`model.haptics`). A template
 * file the components using it hold different things in is noted instead. A namespace import is
 * noted.
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

/**
 * Whether `node` is `inject(X)` for an `X` in `types`: the import, not a parameter or variable of
 * the same name that shadows it.
 */
const isInjected = (ts, node, types) =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'inject' &&
  node.arguments.length >= 1 &&
  ts.isIdentifier(node.arguments[0]) &&
  types.has(node.arguments[0].text) &&
  nearestBinding(ts, node.arguments[0]) === undefined;

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
      notes.push(
        `${file}:${line(call)}: available() is a signal now, false until the platform answers, ` +
          'so without the await this reads false at first. Read it where a change shows, in a ' +
          'template or a computed(), rather than once.',
      );
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

/**
 * A property read of `name.available`, not already called, where `name` is the component's own:
 * read bare or as `this.name`, and not as a member of something else, as in
 * `model.haptics.available`.
 */
const propertyRead = (name) =>
  new RegExp(
    `(?<![\\w$])(?<!(?<!\\bthis\\s*)\\s*\\.\\s*)${name}(?:\\.available\\b|\\[\\s*['"]available['"]\\s*\\])(?!\\s*\\()`,
    'g',
  );

/** A bound attribute, `[x]`, `(x)`, `[(x)]` or `*x`, and where its quoted value starts. */
const BOUND = /(?:\[\(?[^\s=\]]+\)?\]|\([^\s=)]+\)|\*[\w-]+)\s*=\s*(["'])/g;

/** A block whose parameters are an expression: `@if (`, `@else if (`, `@for (` and the rest. */
const BLOCK = /@(?:if|else\s+if|for|switch|case|defer)\s*\(/g;

/**
 * An expression from `from` to where `ends` says it ends, outside any quoted string in it: where it
 * ends, and the pieces of it that are code rather than a string's contents, which are text.
 */
function scan(text, from, ends) {
  const code = [];
  let piece = from;
  let quote = null;
  for (let at = from; at < text.length; at++) {
    const char = text[at];
    if (quote === '`' && text.startsWith('${', at)) {
      // A substitution in a template string is code again, to its closing brace.
      const inner = scan(text, at + 2, closingBrace(text));
      code.push(...inner.code);
      at = inner.end;
    } else if (quote) {
      if (char === '\\') at++;
      else if (char === quote) [quote, piece] = [null, at + 1];
    } else if (ends(at)) {
      code.push([piece, at]);
      return { end: at, code };
    } else if (char === "'" || char === '"' || char === '`') {
      code.push([piece, at]);
      quote = char;
    }
  }
  if (!quote) code.push([piece, text.length]);
  return { end: text.length, code };
}

/** For `scan`: the end is where the parenthesis open before it closes, past the ones inside it. */
function closing(text) {
  let depth = 1;
  return (at) => {
    if (text[at] === '(') depth++;
    else if (text[at] === ')') depth--;
    return depth === 0;
  };
}

/** Each `{{ }}` interpolation's span. */
function interpolationsOf(text) {
  const spans = [];
  for (let at = text.indexOf('{{'); at !== -1;) {
    const { end } = scan(text, at + 2, (here) => text.startsWith('}}', here));
    spans.push([at, end]);
    // Past the whole span, so a `{{` in a string inside it starts no second one.
    at = text.indexOf('{{', end + 2);
  }
  return spans;
}

/**
 * Each tag's span, from its `<` to its `>`, past a `>` in a quoted attribute value, and in
 * `values` each quoted attribute value's span.
 */
function tagsOf(text, values = []) {
  const tags = [];
  // A `<` in an interpolation is a comparison, `{{ a <b }}`, not a tag.
  const interpolations = interpolationsOf(text);
  for (const match of text.matchAll(/<[a-zA-Z/]/g)) {
    if (tags.length && match.index < tags[tags.length - 1][1]) continue;
    if (interpolations.some(([start, end]) => match.index > start && match.index < end)) continue;
    let quote = null;
    let end = match.index + 1;
    for (; end < text.length; end++) {
      const char = text[end];
      if (quote) {
        if (char === quote) {
          quote = null;
          values[values.length - 1][1] = end;
        }
      } else if (char === '"' || char === "'") {
        quote = char;
        values.push([end, text.length]);
      } else if (char === '>') break;
    }
    tags.push([match.index, end]);
  }
  return tags;
}

/** For `scan`: the end is where the brace open before it closes, past the ones inside it. */
function closingBrace(text) {
  let depth = 1;
  return (at) => {
    if (text[at] === '{') depth++;
    else if (text[at] === '}') depth--;
    return depth === 0;
  };
}

/**
 * The spans of a template Angular reads as code: `{{ }}` interpolations, bound attribute values,
 * block parameters and `@let` values, less the strings in them. Text, plain attribute values and
 * a string constant are shown as they are, so a `name.available` there is left alone.
 */
function expressions(text) {
  const spans = [];
  for (let at = text.indexOf('{{'); at !== -1; at = text.indexOf('{{', at)) {
    const { end, code } = scan(text, at + 2, (here) => text.startsWith('}}', here));
    spans.push(...code);
    at = end + 2;
  }
  // A binding is one only as an attribute of a tag, not inside another attribute's quoted text.
  const values = [];
  const tags = tagsOf(text, values);
  const within = (index, ranges) => ranges.some(([start, end]) => index > start && index < end);
  for (const match of text.matchAll(BOUND)) {
    if (!within(match.index, tags) || within(match.index, values)) continue;
    const quote = match[1];
    spans.push(...scan(text, match.index + match[0].length, (at) => text[at] === quote).code);
  }
  // A block is one only outside a tag: `label="@if (x)"` is an attribute's text.
  const outside = (match) => !tags.some(([start, end]) => match.index > start && match.index < end);
  for (const match of [...text.matchAll(BLOCK)].filter(outside)) {
    spans.push(...scan(text, match.index + match[0].length, closing(text)).code);
  }
  for (const match of [...text.matchAll(/@let\s+[\w$]+\s*=/g)].filter(outside)) {
    spans.push(...scan(text, match.index + match[0].length, (at) => text[at] === ';').code);
  }
  return spans;
}

/** Where in `text` an expression reads `name.available` as a property. */
function readsOf(text, name) {
  const spans = expressions(text);
  return [...text.matchAll(propertyRead(name))]
    .map((match) => match.index)
    .filter((index) => spans.some(([start, end]) => index >= start && index < end));
}

/** A template with each holder's `.available` called, and the names it left as declared there. */
function inTemplate(text, names) {
  const calls = [];
  const left = [];
  for (const name of new Set(names)) {
    const reads = new Set(readsOf(text, name));
    if (declaration(name).test(text)) {
      if (reads.size) left.push(name);
      continue;
    }
    for (const match of text.matchAll(propertyRead(name))) {
      if (reads.has(match.index)) calls.push(match.index + match[0].length);
    }
  }
  return { calls, left };
}

/** `text` with `()` written at each of `calls`. */
const withCalls = (text, calls) =>
  applied(
    text,
    calls.map((at) => ({ start: at, end: at, text: '()' })),
  );

/**
 * A string literal's text as it decodes, which is the template Angular reads, and for each of its
 * characters, and its end, where it is in the literal's source: `\'` is one character, two long.
 */
function decode(raw) {
  let text = '';
  const at = [];
  for (let index = 1; index < raw.length - 1; index++) {
    at.push(index);
    if (raw[index] !== '\\') {
      text += raw[index];
      continue;
    }
    const [char, length] = escaped(raw, index + 1);
    if (char === '') at.pop();
    // One place for each UTF-16 unit, as an escape past U+FFFF decodes to two.
    for (let unit = 1; unit < char.length; unit++) at.push(index);
    text += char;
    index += length;
  }
  at.push(raw.length - 1);
  return { text, at };
}

const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };

/** The character an escape after a backslash at `index` stands for, and how long it is. */
function escaped(raw, index) {
  const char = raw[index];
  const hex = /^(?:x([\da-fA-F]{2})|u([\da-fA-F]{4})|u\{([\da-fA-F]+)\})/.exec(raw.slice(index));
  if (hex) return [String.fromCodePoint(parseInt(hex[1] ?? hex[2] ?? hex[3], 16)), hex[0].length];
  if (char === '\r' && raw[index + 1] === '\n') return ['', 2];
  if (char === '\n' || char === '\r') return ['', 1];
  return [ESCAPES[char] ?? char, 1];
}

const declarationLine = (text, name) =>
  text.slice(0, text.search(declaration(name))).split('\n').length;

const readLine = (text, name) => text.slice(0, readsOf(text, name)[0]).split('\n').length;

const sharedNote = (where, name) =>
  `${where}: Not every component that uses this template holds a service as ${name}, so it was ` +
  `left as it is. Where it reads the service, call ${name}.available().`;

const localNote = (where, name) =>
  `${where}: The template declares a ${name} of its own, so it was left as it is. ` +
  `Where it reads the component's service, call ${name}.available().`;

/**
 * The names `Component` is read by when imported from `@angular/core`: by name, under an alias,
 * or off a namespace import, as `ng.Component`.
 */
function componentNames(ts, source) {
  const names = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== '@angular/core') {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.add(`${bindings.name.text}.Component`);
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
    // Read as it decodes, so an escaped quote is the quote Angular sees, and each call written
    // back where that character is in the source.
    const decoded = decode(value.getText());
    const { calls, left } = inTemplate(decoded.text, names);
    const line = source.getLineAndCharacterOfPosition(property.getStart()).line + 1;
    for (const name of left) found.notes.push(localNote(`${file}:${line}`, name));
    for (const call of calls) {
      const start = value.getStart() + decoded.at[call];
      found.edits.push({ start, end: start, text: '()' });
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
    // Every component is recorded, holding a service or not, so a template file several of them
    // share is rewritten only when each holds the same.
    if (metadata) {
      const names = classHolders(ts, node, types).instance;
      componentTemplate(ts, source, file, metadata, names, dir, found);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const parse = (ts, file, text) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(ts, file));

/** Rewrites one source file, and answers the template files it names, each with its holders. */
function rewriteSource(ts, host, file, text, notes) {
  const source = parse(ts, file, text);
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
    return templates(ts, source, file, new Set()).urls;
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
  // Each template file, with the holders of each component that uses it.
  const users = new Map();
  for (const file of files(host)) {
    const text = SOURCE.test(file) ? host.read(file) : null;
    if (text === null) continue;
    let urls = [];
    if ([...ENTRIES].some((entry) => text.includes(entry))) {
      urls = rewriteSource(ts, host, file, text, notes);
    } else if (text.includes('templateUrl')) {
      urls = templates(ts, parse(ts, file, text), file, new Set()).urls;
    }
    for (const [url, names] of urls) users.set(url, [...(users.get(url) ?? []), new Set(names)]);
  }
  for (const [url, held] of users) rewriteTemplate(host, url, held, notes);
  return notes;
}

/**
 * Rewrites a template file for the holders of the components that use it, unless they differ on
 * a name it reads `available` from: one component's service is another's plain object.
 */
function rewriteTemplate(host, url, held, notes) {
  const text = host.read(url);
  if (text === null) return;
  const names = new Set(held.flatMap((each) => [...each]));
  const split = [...names].filter(
    (name) => held.some((each) => !each.has(name)) && readsOf(text, name).length > 0,
  );
  if (split.length) {
    for (const name of split) notes.push(sharedNote(`${url}:${readLine(text, name)}`, name));
    return;
  }
  const { calls, left } = inTemplate(text, names);
  for (const name of left) notes.push(localNote(`${url}:${declarationLine(text, name)}`, name));
  if (calls.length) host.write(url, withCalls(text, calls));
}

module.exports = { availableSignal };
