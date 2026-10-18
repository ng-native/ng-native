/**
 * Rewrites reads of an engine node's fields that were renamed, for the migrations that rename
 * them: `engine-node-tag` and `engine-node-fields`.
 *
 * A field such as `.name` or `.text` is everywhere, and a file's syntax does not say what most of
 * it is read from, so a read is rewritten only where what it is read from is known to be one of
 * the node types: a name whose nearest declaration is typed as one, or initialised with one;
 * `this.` a field typed as one, or `this` in a class that implements one; `x as EngineNode`; a
 * node's `parent`, an item of its `children` (or `childList`), and the item a `for...of` or a
 * `forEach`, `map`, `filter`, `some`, `every` or `find` callback takes from them; and
 * `nativeElement` of an `ElementRef<EngineNode>`. A type counts when it names one of the node
 * types, as imported (an alias or a namespace import included), or an interface or type in the
 * file built on one. `{ name }` destructured from a node becomes `{ tag: name }`, and an object
 * literal written as one of these types has its `name` key become `tag`.
 *
 * Everything else is left as it is. In a file that imports one of the types, a read it cannot
 * place is noted with its file and line, and so is one from a `nativeElement` anywhere, because an
 * `ElementRef` holds `any` unless it is told otherwise. So is a field read from, or taken out of,
 * a node cast to another type: `(node as { name?: string }).name` still compiles once the field is
 * gone, and reads `undefined`.
 */
const { applied, scriptKind, SOURCE, typescript } = require('./move-imports.cjs');
const { files } = require('./host.cjs');
const { ELSE, isStatic, nearestBinding, thisOf } = require('./scope.cjs');

/** What an expression is, as far as this migration needs to know. */
const NODE = 'node';
const NODES = 'nodes';
const REF = 'element ref';
/** Anything else, as a type written out says. */
const OTHER = 'other';

/** Types that say nothing of what a value is. */
const LOOSE = /^(any|unknown|object|Object|\{\s*\})$/;

/** Expressions whose value is never a node: literals, functions and constructed objects. */
const VALUES = [
  'isObjectLiteralExpression',
  'isArrayLiteralExpression',
  'isNewExpression',
  'isClassExpression',
  'isFunctionExpression',
  'isArrowFunction',
  'isStringLiteral',
  'isNoSubstitutionTemplateLiteral',
  'isTemplateExpression',
];

/** `expression` without the parentheses and `!` around it. */
function unwrapped(ts, expression) {
  let inner = expression;
  while (ts.isParenthesizedExpression(inner) || ts.isNonNullExpression(inner)) {
    inner = inner.expression;
  }
  return inner;
}

/** `x as T`, `<T>x` or `x satisfies T`. */
const isAssertion = (ts, expression) =>
  ts.isAsExpression(expression) ||
  ts.isTypeAssertionExpression(expression) ||
  ts.isSatisfiesExpression(expression);

/** A node's children, by the name they had and the name they have. */
const CHILDREN = new Set(['children', 'childList']);

/** Array methods whose callback takes an item as its first parameter. */
const EACH = new Set(['forEach', 'map', 'flatMap', 'filter', 'some', 'every', 'find', 'findLast']);
/** Array methods that answer one item. */
const ITEM = new Set(['at', 'find', 'findLast']);
/** Array methods that answer some of the items, as an array. */
const SOME = new Set(['filter', 'slice', 'toReversed', 'toSorted']);

/** The names the node types go by in a file: as imported, aliased, or through a namespace. */
function imported(ts, source, types) {
  const names = new Set();
  for (const statement of source.statements) {
    const wanted = ts.isImportDeclaration(statement) && types[statement.moduleSpecifier.text];
    const bindings = wanted && statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      for (const type of wanted) names.add(`${bindings.name.text}.${type}`);
      continue;
    }
    for (const element of bindings.elements) {
      if (wanted.includes((element.propertyName ?? element.name).text)) {
        names.add(element.name.text);
      }
    }
  }
  return names;
}

/** The types a declared type can be, less parentheses, `null` and `undefined`. */
function variants(ts, type) {
  if (!type) return [];
  if (ts.isParenthesizedTypeNode(type)) return variants(ts, type.type);
  if (ts.isUnionTypeNode(type)) return type.types.flatMap((member) => variants(ts, member));
  const empty =
    type.kind === ts.SyntaxKind.UndefinedKeyword ||
    (ts.isLiteralTypeNode(type) && type.literal.kind === ts.SyntaxKind.NullKeyword);
  return empty ? [] : [type];
}

/** Whether every type `type` can be is true of `test`, and it can be one at all. */
function always(ts, type, test) {
  const all = variants(ts, type);
  return all.length > 0 && all.every(test);
}

/** Whether a type is a node: one of the node types, or an intersection with one. */
function isNodeType(ts, type, names) {
  return always(ts, type, (one) => {
    if (ts.isTypeReferenceNode(one)) return names.has(one.typeName.getText());
    return ts.isIntersectionTypeNode(one) && one.types.some((part) => isNodeType(ts, part, names));
  });
}

/** The item type of an array type, `T[]`, `readonly T[]`, `Array<T>` or `ReadonlyArray<T>`. */
function itemType(ts, type) {
  if (ts.isTypeOperatorNode(type)) return itemType(ts, type.type);
  if (ts.isArrayTypeNode(type)) return type.elementType;
  const generic =
    ts.isTypeReferenceNode(type) && /^(Readonly)?Array$/.test(type.typeName.getText());
  return generic ? type.typeArguments?.[0] : undefined;
}

/** `ElementRef<T>`'s `T`. */
function refType(ts, type) {
  const ref = ts.isTypeReferenceNode(type) && type.typeName.getText() === 'ElementRef';
  return ref ? type.typeArguments?.[0] : undefined;
}

/** What a declared type says a value is: a node, an array of nodes, an element ref to one. */
function typeKind(ts, type, names) {
  if (isNodeType(ts, type, names)) return NODE;
  if (always(ts, type, (one) => isNodeType(ts, itemType(ts, one), names))) return NODES;
  if (always(ts, type, (one) => isNodeType(ts, refType(ts, one), names))) return REF;
  return null;
}

/** Whether a class says it implements one of the node types. */
const implementsNode = (ts, cls, names) =>
  (cls.heritageClauses ?? []).some(
    (clause) =>
      clause.token === ts.SyntaxKind.ImplementsKeyword &&
      clause.types.some((type) => names.has(type.expression.getText())),
  );

/** What the file knows of each expression it asks about. */
class Reader {
  constructor(ts, names) {
    this.ts = ts;
    this.names = names;
  }

  type(type) {
    return typeKind(this.ts, type, this.names);
  }

  /** What `expression` is: `NODE`, `NODES`, `REF`, or null when this cannot tell. */
  kind(expression, depth = 0) {
    const ts = this.ts;
    const inner = unwrapped(ts, expression);
    if (depth > 32) return null;
    if (isAssertion(ts, inner)) {
      const said = this.type(inner.type);
      if (said || !ts.isSatisfiesExpression(inner)) return said;
      return this.kind(inner.expression, depth + 1);
    }
    if (ts.isIdentifier(inner)) return this.binding(nearestBinding(ts, inner), depth);
    if (inner.kind === ts.SyntaxKind.ThisKeyword) return this.self(inner);
    return this.access(inner, depth);
  }

  /** What a member, an item or a call answers. */
  access(expression, depth) {
    const ts = this.ts;
    if (ts.isPropertyAccessExpression(expression)) return this.member(expression, depth);
    if (ts.isElementAccessExpression(expression)) {
      return this.kind(expression.expression, depth + 1) === NODES ? NODE : null;
    }
    return ts.isCallExpression(expression) ? this.call(expression, depth) : null;
  }

  /** `this`, which is a node in a class that implements a node type. */
  self(expression) {
    const self = thisOf(this.ts, expression);
    return self && !self.static && implementsNode(this.ts, self.cls, this.names) ? NODE : null;
  }

  /** `x.parent`, `x.children`, `ref.nativeElement`, or `this.field`. */
  member(expression, depth) {
    const ts = this.ts;
    const name = expression.name.text;
    if (expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const self = thisOf(ts, expression);
      const field = self && this.field(self.cls, name, self.static);
      if (field) return field;
    }
    const of = this.kind(expression.expression, depth + 1);
    if (of === NODE && name === 'parent') return NODE;
    if (of === NODE && CHILDREN.has(name)) return NODES;
    return of === REF && name === 'nativeElement' ? NODE : null;
  }

  /** An array method's answer, or `inject<ElementRef<EngineNode>>(ElementRef)`. */
  call(expression, depth) {
    const ts = this.ts;
    const callee = expression.expression;
    if (ts.isIdentifier(callee) && callee.text === 'inject') {
      return this.type(expression.typeArguments?.[0]) === REF ? REF : null;
    }
    if (!ts.isPropertyAccessExpression(callee)) return null;
    if (this.kind(callee.expression, depth + 1) !== NODES) return null;
    if (ITEM.has(callee.name.text)) return NODE;
    return SOME.has(callee.name.text) ? NODES : null;
  }

  /** What a class's field or getter `name` holds, from its type or its initialiser. */
  field(cls, name, onClass) {
    const declaration = this.fieldDeclaration(cls, name, onClass);
    if (!declaration) return null;
    if (declaration.type) return this.type(declaration.type);
    return declaration.initializer ? this.kind(declaration.initializer, 1) : null;
  }

  /**
   * The declaration of a class's field or getter `name`, a constructor parameter declared as a
   * field (`constructor(readonly node: EngineNode)`) included.
   */
  fieldDeclaration(cls, name, onClass) {
    const ts = this.ts;
    const named = (one) => one.name && ts.isIdentifier(one.name) && one.name.text === name;
    const member = cls.members.find(
      (one) =>
        named(one) &&
        isStatic(ts, one) === onClass &&
        (ts.isPropertyDeclaration(one) || ts.isGetAccessorDeclaration(one)),
    );
    if (member || onClass) return member;
    const constructor = cls.members.find((one) => ts.isConstructorDeclaration(one));
    return constructor?.parameters.find((one) => ts.getModifiers(one)?.length && named(one));
  }

  /** The field `this.name` reads, where `this` is a class's. */
  thisField(expression) {
    const self = thisOf(this.ts, expression);
    return self ? this.fieldDeclaration(self.cls, expression.name.text, self.static) : undefined;
  }

  /** What a variable or parameter holds, from its type, its loop, its callback or its value. */
  binding(declaration, depth) {
    if (!declaration || declaration === ELSE) return null;
    if (declaration.type) return this.type(declaration.type);
    const items = this.iterated(declaration);
    if (items) return this.kind(items, depth + 1) === NODES ? NODE : null;
    return declaration.initializer ? this.kind(declaration.initializer, depth + 1) : null;
  }

  /**
   * The array a declaration takes one item of: a `for...of` variable's, or the first parameter of
   * a callback an array method is given.
   */
  iterated(declaration) {
    const ts = this.ts;
    if (!ts.isParameter(declaration)) {
      const loop = declaration.parent?.parent;
      const item = loop && ts.isForOfStatement(loop) && loop.initializer === declaration.parent;
      return item ? loop.expression : null;
    }
    const callback = declaration.parent;
    const call = callback.parent;
    if (callback.parameters[0] !== declaration || !call || !ts.isCallExpression(call)) return null;
    const callee = call.expression;
    if (call.arguments[0] !== callback || !ts.isPropertyAccessExpression(callee)) return null;
    return EACH.has(callee.name.text) ? callee.expression : null;
  }

  /** What an explicit type says: its kind, `OTHER` for any other type, null when it says nothing. */
  says(type) {
    if (!type || LOOSE.test(type.getText())) return null;
    return this.type(type) ?? OTHER;
  }

  /**
   * Whether `expression` is a node cast to another type, `node as { name?: string }`: the type it
   * is read as hides the node, and a field that type declares still compiles after the rename.
   */
  castNode(expression, depth = 0) {
    const ts = this.ts;
    const inner = unwrapped(ts, expression);
    if (depth > 32 || !isAssertion(ts, inner) || this.type(inner.type)) return false;
    return (
      this.kind(inner.expression, depth + 1) === NODE || this.castNode(inner.expression, depth + 1)
    );
  }

  /** Whether `expression` is certainly not a node, so a `name` read from it is no tag. */
  notNode(expression, depth = 0) {
    const ts = this.ts;
    const inner = unwrapped(ts, expression);
    if (depth > 32) return false;
    if (VALUES.some((is) => ts[is](inner))) return true;
    if (inner.kind === ts.SyntaxKind.ThisKeyword) return Boolean(thisOf(ts, inner));
    if (isAssertion(ts, inner)) return this.says(inner.type) === OTHER;
    if (ts.isIdentifier(inner)) return this.notNodeBinding(nearestBinding(ts, inner), depth);
    if (ts.isElementAccessExpression(inner)) return this.notNodes(inner.expression, depth + 1);
    if (ts.isPropertyAccessExpression(inner)) return this.notNodeMember(inner, depth);
    const items = methodOf(ts, inner, ITEM);
    return Boolean(items) && this.notNodes(items, depth + 1);
  }

  /** Whether `x.y` is certainly not a node: a constructor, or a member typed otherwise. */
  notNodeMember(access, depth) {
    const ts = this.ts;
    if (access.name.text === 'constructor') return true;
    const of = unwrapped(ts, access.expression);
    if (of.kind === ts.SyntaxKind.ThisKeyword) {
      const field = this.thisField(access);
      return Boolean(field) && this.notNodeBinding(field, depth);
    }
    const literal = isAssertion(ts, of) && ts.isTypeLiteralNode(of.type) && of.type;
    const member =
      literal && literal.members.find((one) => one.name?.getText() === access.name.text);
    return Boolean(member) && this.says(member.type) === OTHER;
  }

  /** Whether a variable, parameter or field is certainly not a node. */
  notNodeBinding(declaration, depth) {
    if (!declaration) return true;
    if (declaration === ELSE) return false;
    const said = this.says(declaration.type);
    if (said) return said === OTHER;
    const items = this.iterated(declaration);
    if (items) return this.notNodes(items, depth + 1);
    return Boolean(declaration.initializer) && this.notNode(declaration.initializer, depth + 1);
  }

  /** Whether `expression` is certainly not an array of nodes. */
  notNodes(expression, depth) {
    const ts = this.ts;
    const inner = unwrapped(ts, expression);
    if (depth > 32) return false;
    if (isAssertion(ts, inner)) return ![null, NODES].includes(this.says(inner.type));
    if (ts.isCallExpression(inner)) {
      const items = methodOf(ts, inner, SOME);
      return Boolean(items) && this.notNodes(items, depth + 1);
    }
    const declaration = this.declarationOf(inner);
    if (!declaration) return true;
    if (declaration === ELSE) return false;
    const said = this.says(declaration.type);
    if (said) return said !== NODES;
    return Boolean(declaration.initializer) && this.notNodes(declaration.initializer, depth + 1);
  }

  /** The declaration of a name, or of `this.field`, as `nearestBinding` answers; `ELSE` else. */
  declarationOf(expression) {
    const ts = this.ts;
    if (ts.isIdentifier(expression)) return nearestBinding(ts, expression);
    const own =
      ts.isPropertyAccessExpression(expression) &&
      expression.expression.kind === ts.SyntaxKind.ThisKeyword;
    return (own && this.thisField(expression)) || ELSE;
  }

  /** What an object literal is written as: the type it is declared, asserted or returned as. */
  written(literal) {
    const ts = this.ts;
    let at = literal;
    while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
    const parent = at.parent;
    if (ts.isArrayLiteralExpression(parent)) return this.written(parent) === NODES ? NODE : null;
    return this.type(givenType(ts, parent, at));
  }
}

/** The type `parent` gives the value `at` in it: as a declaration, an assertion or a return. */
function givenType(ts, parent, at) {
  if (isAssertion(ts, parent)) return parent.type;
  if (ts.isReturnStatement(parent)) return ts.getContainingFunction(parent)?.type;
  if (ts.isArrowFunction(parent)) return parent.body === at ? parent.type : undefined;
  const declared = ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent);
  return declared && parent.initializer === at ? parent.type : undefined;
}

/** The array `call` calls one of `methods` on, as `nodes.find(...)` does. */
function methodOf(ts, call, methods) {
  const callee = ts.isCallExpression(call) && call.expression;
  const named = callee && ts.isPropertyAccessExpression(callee) && methods.has(callee.name.text);
  return named ? callee.expression : null;
}

/** The edit that renames a property name node to `to`, keeping a string's quotes. */
function renamed(name, to) {
  const start = name.getStart();
  const quoted = name.getText() !== name.text;
  return { start: quoted ? start + 1 : start, end: name.getEnd() - (quoted ? 1 : 0), text: to };
}

/** `{ name }` taken from a node as `{ tag: name }`, and `{ name: n }` as `{ tag: n }`. */
function destructured(ts, pattern, edits, fields) {
  for (const element of pattern.elements) {
    const key = element.propertyName ?? (element.dotDotDotToken ? null : element.name);
    const field =
      key && ts.isIdentifier(key) && Object.hasOwn(fields, key.text) && fields[key.text];
    if (!field) continue;
    if (element.propertyName) edits.push(renamed(key, field.to));
    else edits.push({ start: key.getStart(), end: key.getStart(), text: `${field.to}: ` });
  }
}

/** The renamed field a destructuring pattern takes, if any. */
function takenField(ts, pattern, fields) {
  for (const element of pattern.elements) {
    const key = element.propertyName ?? (element.dotDotDotToken ? null : element.name);
    if (key && ts.isIdentifier(key) && Object.hasOwn(fields, key.text)) return key.text;
  }
  return null;
}

/** An object literal written as a node with its `name` key as `tag`. */
function literal(ts, object, edits, fields) {
  for (const property of object.properties) {
    const key = property.name;
    const named = key && (ts.isIdentifier(key) || ts.isStringLiteral(key));
    const field = named && Object.hasOwn(fields, key.text) && fields[key.text];
    if (!field) continue;
    if (ts.isShorthandPropertyAssignment(property)) {
      edits.push({ start: key.getStart(), end: key.getStart(), text: `${field.to}: ` });
    } else if (ts.isPropertyAssignment(property)) {
      edits.push(renamed(key, field.to));
    }
  }
}

/** Where a node is in its file, as a note gives it. */
const lineOf = (source, node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;

/** The note for a read of `old` this migration cannot tell is a node's. */
function note(file, source, access, old, field) {
  const read = access.getText().replace(/\s+/g, ' ');
  const at = read.lastIndexOf(old);
  const instead = read.slice(0, at) + field.to + read.slice(at + old.length);
  return (
    `${file}:${lineOf(source, access)}: ${read} may be an engine node's ${field.what}, which is ` +
    `now ${field.to}. If it is, read ${instead} instead.`
  );
}

/** The note for a field taken from a node cast to another type, which still compiles. */
function castNote(file, source, node, verb, old, field) {
  const text = node.getText().replace(/\s+/g, ' ');
  return (
    `${file}:${lineOf(source, node)}: ${text} ${verb}s ${old} from an engine node read as ` +
    `another type. Its ${field.what} is now ${field.to}: ${verb} ${field.to}, and say so in the type.`
  );
}

/** A `.name` or `['name']` of a renamed field: what it is read from, and the property's node. */
function fieldRead(ts, node, fields) {
  if (ts.isPropertyAccessExpression(node) && Object.hasOwn(fields, node.name.text)) {
    return { receiver: node.expression, key: node.name };
  }
  const argument = ts.isElementAccessExpression(node) && node.argumentExpression;
  if (argument && ts.isStringLiteralLike(argument) && Object.hasOwn(fields, argument.text)) {
    return { receiver: node.expression, key: argument };
  }
  return null;
}

/** Whether a `.name` is read from an `ElementRef`'s `nativeElement`. */
const fromNativeElement = (ts, receiver) =>
  ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'nativeElement';

/** One read of a field: an edit where it is a node's, a note where it may be. */
function read(context, node) {
  const { ts, reader, edits, notes, file, source, typed, fields } = context;
  const found = fieldRead(ts, node, fields);
  if (!found) return;
  const field = fields[found.key.text];
  if (reader.kind(found.receiver) === NODE) {
    edits.push(renamed(found.key, field.to));
    return;
  }
  if (reader.castNode(found.receiver)) {
    notes.push(castNote(file, source, node, 'read', found.key.text, field));
    return;
  }
  const unsure = fromNativeElement(ts, found.receiver) || typed;
  const said =
    unsure && !reader.notNode(found.receiver) && note(file, source, node, found.key.text, field);
  if (said && !notes.includes(said)) {
    notes.push(said);
  }
}

/** The destructuring patterns and object literals that name a field as a key of a node. */
function keys(context, node) {
  const { ts, reader, edits, notes, file, source, fields } = context;
  const pattern =
    (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
    ts.isObjectBindingPattern(node.name);
  if (pattern && reader.binding(node, 0) === NODE) destructured(ts, node.name, edits, fields);
  else if (pattern && node.initializer && reader.castNode(node.initializer)) {
    const taken = takenField(ts, node.name, fields);
    if (taken) notes.push(castNote(file, source, node, 'take', taken, fields[taken]));
  }
  if (ts.isObjectLiteralExpression(node) && reader.written(node) === NODE) {
    literal(ts, node, edits, fields);
  }
}

/** A renamed field or getter of a class that implements a node type, by its new name. */
function ownField(context, node) {
  const { ts, reader, edits, fields } = context;
  const member = ts.isPropertyDeclaration(node) || ts.isGetAccessorDeclaration(node);
  const own = member && ts.isIdentifier(node.name) && Object.hasOwn(fields, node.name.text);
  if (own && ts.isClassLike(node.parent) && implementsNode(ts, node.parent, reader.names)) {
    edits.push(renamed(node.name, fields[node.name.text].to));
  }
}

/** Rewrites one file's reads of a node's renamed fields, and answers its notes. */
function rewrite(ts, host, file, text, { types, fields }) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(ts, file),
  );
  const names = imported(ts, source, types);
  localTypes(ts, source, names);
  const context = {
    ts,
    reader: new Reader(ts, names),
    edits: [],
    notes: [],
    file,
    source,
    typed: names.size > 0,
    fields,
  };
  const visit = (node) => {
    read(context, node);
    keys(context, node);
    ownField(context, node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (context.edits.length) host.write(file, applied(text, context.edits));
  return context.notes;
}

/** An interface or type in the file built on a node type, which is one too. */
function localType(ts, node, names) {
  if (ts.isInterfaceDeclaration(node)) {
    const bases = (node.heritageClauses ?? []).flatMap((clause) => clause.types);
    return bases.some((base) => names.has(base.expression.getText())) ? node.name.text : null;
  }
  const alias = ts.isTypeAliasDeclaration(node) && isNodeType(ts, node.type, names);
  return alias ? node.name.text : null;
}

/** Adds the file's own node types to `names`, until one built on another is found too. */
function localTypes(ts, source, names) {
  if (!names.size) return;
  let grew = true;
  while (grew) {
    grew = false;
    const visit = (node) => {
      const name = localType(ts, node, names);
      if (name && !names.has(name)) {
        names.add(name);
        grew = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

/**
 * A migration that renames node fields: `types` are the node types by the entry point that exports
 * them, and `fields` each old name's new one, with what a note calls it.
 *
 * @param {{ types: Record<string, string[]>, fields: Record<string, { to: string, what: string }> }} spec
 */
function nodeFieldRenames(spec) {
  const word = new RegExp(`\\b(${Object.keys(spec.fields).join('|')})\\b`);
  // Whether a file can read one of the fields at all, before it is parsed.
  const mentions = (text) =>
    text !== null &&
    word.test(text) &&
    (Object.keys(spec.types).some((entry) => text.includes(entry)) ||
      text.includes('nativeElement'));
  /** @param {import('./host.cjs').Host} host */
  return (host) => {
    const ts = typescript();
    const notes = [];
    for (const file of files(host)) {
      const text = SOURCE.test(file) ? host.read(file) : null;
      if (mentions(text)) notes.push(...rewrite(ts, host, file, text, spec));
    }
    return notes;
  };
}

module.exports = { nodeFieldRenames };
