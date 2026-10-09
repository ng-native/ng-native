/**
 * The layout passed to `createLiveActivity` or `createWidget` from `@ng-native/expo/live-activity`,
 * replaced with its source.
 *
 * A widget layout is an Angular component, so `ngc` type-checks its template against its `props`
 * input and the typed `ui-*` components it imports, but the app never renders it: the widget
 * extension does, from the source `expo-widgets` takes (see `widget-layout.cjs`). So the class
 * passed becomes that source, as a string, and the class is blanked out, so it never reaches
 * Angular's compiler or the app's bundle. An import only the class used is left
 * unused, and the TypeScript transform after this drops it.
 *
 * What a layout's class can hold is what can be put in the extension, which has no instance of it:
 * the `props` and `environment` inputs, members holding a modifier imported from
 * `@expo/ui/swift-ui/modifiers`, and members holding a literal. Anything else is an error naming
 * the member and its line. Every replacement keeps the lines it replaces, so the source map stays
 * right.
 */
const { parse } = require('@babel/parser');
const { compileWidgetLayout, LayoutError } = require('./widget-layout.cjs');

const RUNTIME = '@ng-native/expo/live-activity';
const MODIFIERS = '@expo/ui/swift-ui/modifiers';
const INPUTS = new Set(['props', 'environment']);
/** The functions that take a layout, as its second argument. */
const CREATE = new Set(['createLiveActivity', 'createWidget']);

/**
 * @param {string} src
 * @param {string} filename
 */
function inlineWidgetLayouts(src, filename) {
  if (!src.includes(RUNTIME) || !/create(LiveActivity|Widget)/.test(src)) return src;
  const program = parse(src, { sourceType: 'module', plugins: pluginsFor(filename) }).program;

  const callees = new Set(
    [...importedNames(program, RUNTIME)].filter(([, name]) => CREATE.has(name)).map(([l]) => l),
  );
  const namespaces = namespaceImports(program, RUNTIME);
  if (!callees.size && !namespaces.size) return src;
  const modifiers = importedNames(program, MODIFIERS);

  const edits = [];
  const layouts = new Map();
  for (const call of calls(program, callees, namespaces)) {
    const argument = call.arguments[1];
    const found = /** @type {any} */ (layoutOf(filename, program, call, argument));
    if (!layouts.has(found.statement))
      layouts.set(found.statement, compileLayout(filename, found, modifiers));
    edits.push({
      start: argument.start,
      end: argument.end,
      text: JSON.stringify(layouts.get(found.statement)),
    });
  }
  for (const statement of layouts.keys()) {
    edits.push({ start: statement.start, end: statement.end, text: '' });
  }
  refuseOtherUses(filename, program, layouts.keys(), edits);

  return applyEdits(src, edits);
}

/**
 * The module has TypeScript syntax, and JSX too in a `.tsx` file.
 *
 * @returns {import('@babel/parser').ParserPlugin[]}
 */
function pluginsFor(filename) {
  return /\.[cm]?tsx$/.test(filename)
    ? ['typescript', 'jsx', 'decorators-legacy']
    : ['typescript', 'decorators-legacy'];
}

/** The layout class a `createLiveActivity(name, Layout)` call passes. */
function layoutOf(filename, program, call, argument) {
  const found = argument?.type === 'Identifier' && layoutClass(program, argument.name);
  if (found) return found;
  const name = argument?.type === 'Identifier' ? argument.name : 'Its layout';
  return fail(
    filename,
    argument ?? call,
    `${name} is not an @Component class in this file, which is the layout this call takes.`,
  );
}

/** Each edit made, every line it replaces kept, so the source map stays right. */
function applyEdits(src, edits) {
  let out = src;
  for (const { start, end, text } of edits.sort((a, b) => b.start - a.start)) {
    const lines = src.slice(start, end).split('\n').length - 1;
    out = out.slice(0, start) + text + '\n'.repeat(lines) + out.slice(end);
  }
  return out;
}

/** The layout's source, with the class checked for what it can hold. */
function compileLayout(filename, { statement, name, decorator, body }, modifiers) {
  if (statement.type === 'ExportNamedDeclaration') {
    fail(
      filename,
      statement,
      `${name} is exported, but the build removes a layout class: keep it to this file.`,
    );
  }
  const template = /** @type {any} */ (templateOf(filename, decorator));
  return compileWidgetLayout(template.cooked, {
    file: filename,
    at: { line: template.loc.start.line - 1, col: template.loc.start.column },
    members: membersOf(filename, body, modifiers),
  });
}

/**
 * Refuses a layout class the module names anywhere but in the call it is passed to: the build removes
 * the class, so any other use would be left reading nothing.
 */
function refuseOtherUses(filename, program, statements, edits) {
  for (const statement of statements) {
    const declaration = statement.declaration ?? statement;
    const { name } = declaration.id;
    const within = (node, range) => node.start >= range.start && node.end <= range.end;
    walk(program, (node, parent, key) => {
      if (node.type !== 'Identifier' || node.name !== name || within(node, declaration)) return;
      if (isPropertyName(parent, key) || edits.some((e) => e.text && within(node, e))) return;
      fail(
        filename,
        node,
        `${name} is used here, but the build removes a layout class: pass it only to createLiveActivity or createWidget.`,
      );
    });
  }
}

/** Whether an identifier is the name of a property, rather than a reference: `a.name`, `{ name: 1 }`. */
function isPropertyName(parent, key) {
  if (parent.computed) return false;
  if (parent.type === 'MemberExpression') return key === 'property';
  return (parent.type === 'ObjectProperty' || parent.type === 'ClassProperty') && key === 'key';
}

/** Calls `visit(node, parent, key)` for every node under `root`, without recursion. */
function walk(root, visit) {
  const stack = [[root, null, null]];
  while (stack.length) {
    const [node, parent, key] = /** @type {any[]} */ (stack.pop());
    if (parent) visit(node, parent, key);
    for (const child of Object.keys(node)) {
      if (child === 'loc' || child.endsWith('Comments')) continue;
      const value = node[child];
      for (const item of Array.isArray(value) ? value : [value]) {
        if (typeof item?.type === 'string') stack.push([item, node, child]);
      }
    }
  }
}

/** The local names of each `import * as` from `specifier`. */
function namespaceImports(program, specifier) {
  const names = new Set();
  for (const node of program.body) {
    if (node.type !== 'ImportDeclaration' || node.source.value !== specifier) continue;
    for (const s of node.specifiers) {
      if (s.type === 'ImportNamespaceSpecifier') names.add(s.local.name);
    }
  }
  return names;
}

/** Local name to imported name, for each named import from `specifier`. */
function importedNames(program, specifier) {
  const names = new Map();
  for (const node of program.body) {
    if (node.type !== 'ImportDeclaration' || node.source.value !== specifier) continue;
    for (const s of node.specifiers) {
      if (s.type === 'ImportSpecifier') {
        names.set(s.local.name, s.imported.name ?? s.imported.value);
      }
    }
  }
  return names;
}

/** Every call to one of `names`, or to a `CREATE` function read from one of `namespaces`. */
function calls(program, names, namespaces) {
  const found = [];
  walk(program, (node) => {
    if (node.type !== 'CallExpression') return;
    const { callee } = node;
    const named = callee.type === 'Identifier' && names.has(callee.name);
    const read =
      callee.type === 'MemberExpression' &&
      !callee.computed &&
      namespaces.has(callee.object.name) &&
      CREATE.has(callee.property.name);
    if (named || read) found.push(node);
  });
  return found.sort((a, b) => a.start - b.start);
}

/** The top-level `@Component` class named `name`, with the statement that declares it. */
function layoutClass(program, name) {
  for (const statement of program.body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (declaration?.type !== 'ClassDeclaration' || declaration.id?.name !== name) continue;
    const decorator = declaration.decorators?.find(
      (d) => d.expression.type === 'CallExpression' && d.expression.callee.name === 'Component',
    );
    if (!decorator) return null;
    return { statement, name, decorator, body: declaration.body.body };
  }
  return null;
}

/** The decorator's inline template: its text, and where its text starts. */
function templateOf(filename, decorator) {
  const [metadata] = decorator.expression.arguments;
  const properties = metadata?.type === 'ObjectExpression' ? metadata.properties : [];
  const property = (key) => properties.find((p) => p.key?.name === key || p.key?.value === key);
  const url = property('templateUrl');
  if (url) fail(filename, url, 'A widget layout takes an inline template, not a templateUrl.');
  const value = property('template')?.value;
  if (value?.type === 'StringLiteral') {
    // The text starts after the quote.
    const start = { line: value.loc.start.line, column: value.loc.start.column + 1 };
    return { cooked: value.value, loc: { start } };
  }
  if (value?.type === 'TemplateLiteral' && value.expressions.length === 0) {
    const [quasi] = value.quasis;
    return { cooked: quasi.value.cooked, loc: quasi.loc };
  }
  return fail(filename, value ?? decorator, 'A widget layout takes its template as a string.');
}

/** What the compiler needs of the class's members. */
function membersOf(filename, body, modifiers) {
  const members = { props: 'props', environment: 'environment', modifiers: {}, constants: {} };
  for (const member of body) {
    const name = member.key?.name;
    if (member.type === 'ClassPrivateProperty') {
      fail(
        filename,
        member,
        `#${member.key.id.name} is private, and the widget extension can read only the layout's own members.`,
      );
    }
    if (member.type !== 'ClassProperty') {
      fail(
        filename,
        member,
        `${name ?? 'A member'} is a method, which the widget extension has no instance to call.`,
      );
    }
    const value = unwrap(member.value);
    if (isInput(value)) {
      if (!INPUTS.has(name)) {
        fail(
          filename,
          member,
          `${name} is an input; a widget layout's inputs are props and environment.`,
        );
      }
    } else if (value?.type === 'Identifier' && modifiers.has(value.name)) {
      members.modifiers[name] = modifiers.get(value.name);
    } else if (literalSource(value) !== null) {
      members.constants[name] = literalSource(value);
    } else {
      fail(
        filename,
        member,
        `${name} is not a literal or a modifier from ${MODIFIERS}, the only members the widget extension can have.`,
      );
    }
  }
  return members;
}

/** `value as const` and `value satisfies T` are `value`. */
function unwrap(node) {
  while (node && (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression')) {
    node = node.expression;
  }
  return node;
}

/** `input()`, `input<T>()`, `input.required<T>()`. */
function isInput(node) {
  if (node?.type !== 'CallExpression') return false;
  const { callee } = node;
  if (callee.type === 'Identifier') return callee.name === 'input';
  return (
    callee.type === 'MemberExpression' &&
    callee.object.name === 'input' &&
    callee.property.name === 'required'
  );
}

/**
 * A value written out in full, as JavaScript the extension can run, with any TypeScript in it left
 * out: what the extension can have a copy of. Null for anything else.
 */
function literalSource(node) {
  node = unwrap(node);
  return LITERALS[node?.type]?.(node) ?? null;
}

/** How each kind of literal is written out, or null for one with something else inside. */
const LITERALS = {
  StringLiteral: (node) => JSON.stringify(node.value),
  NumericLiteral: (node) => JSON.stringify(node.value),
  BooleanLiteral: (node) => JSON.stringify(node.value),
  NullLiteral: () => 'null',
  TemplateLiteral: (node) =>
    node.expressions.length === 0 ? JSON.stringify(node.quasis[0].value.cooked) : null,
  UnaryExpression: (node) =>
    node.operator === '-' && node.argument.type === 'NumericLiteral'
      ? JSON.stringify(-node.argument.value)
      : null,
  ArrayExpression: (node) => joined(node.elements.map(literalSource), '[', ']'),
  ObjectExpression: (node) => joined(node.properties.map(entrySource), '{', '}'),
};

/** An object literal's entry as JavaScript, or null when it is not a plain key and literal. */
function entrySource(property) {
  if (property.type !== 'ObjectProperty' || property.computed) return null;
  const value = literalSource(property.value);
  const key = property.key.name ?? String(property.key.value);
  return value === null ? null : `${JSON.stringify(key)}:${value}`;
}

const joined = (parts, open, close) =>
  parts.includes(null) ? null : `${open}${parts.join(',')}${close}`;

function fail(filename, node, message) {
  throw new LayoutError(
    filename,
    { start: { line: node.loc.start.line - 1, col: node.loc.start.column } },
    message,
  );
}

module.exports = { inlineWidgetLayouts };
