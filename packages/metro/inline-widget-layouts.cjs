/**
 * `widgetLayout(Layout)` calls, replaced with the source of the layout they name.
 *
 * A widget layout is an Angular component, so `ngc` type-checks its template against its `props`
 * input and the typed `ui-*` components it imports, but the app never renders it: the widget
 * extension does, from the source `createLiveActivity` and `createWidget` take (see
 * `widget-layout.cjs`). So the call becomes that source, as a string, and the class is blanked out,
 * so it never reaches Angular's compiler or the app's bundle. An import only the class used is left
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

/**
 * @param {string} src
 * @param {string} filename
 */
function inlineWidgetLayouts(src, filename) {
  if (!src.includes('widgetLayout') || !src.includes(RUNTIME)) return src;
  const program = parse(src, {
    sourceType: 'module',
    plugins: ['typescript', 'decorators-legacy'],
  }).program;

  const runtime = importedNames(program, RUNTIME);
  const callee = [...runtime].find(([, imported]) => imported === 'widgetLayout')?.[0];
  if (!callee) return src;
  const modifiers = importedNames(program, MODIFIERS);

  const edits = [];
  for (const call of calls(program, callee)) {
    const [argument] = call.arguments;
    const found = argument?.type === 'Identifier' && layoutClass(program, argument.name);
    if (!found) {
      const name = argument?.type === 'Identifier' ? argument.name : 'its argument';
      fail(
        filename,
        call,
        `widgetLayout(${name}): ${name} is not an @Component class in this file.`,
      );
    }
    const { statement, decorator, body } = found;
    const template = templateOf(filename, decorator);
    const members = membersOf(filename, src, body, modifiers);
    const source = compileWidgetLayout(template.cooked, {
      file: filename,
      at: { line: template.loc.start.line - 1, col: template.loc.start.column },
      members,
    });
    edits.push({ start: call.start, end: call.end, text: JSON.stringify(source) });
    edits.push({ start: statement.start, end: statement.end, text: '' });
  }

  let out = src;
  for (const { start, end, text } of edits.sort((a, b) => b.start - a.start)) {
    const lines = src.slice(start, end).split('\n').length - 1;
    out = out.slice(0, start) + text + '\n'.repeat(lines) + out.slice(end);
  }
  return out;
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

/** Every call to `name` in the module. */
function calls(program, name) {
  const found = [];
  const stack = [program];
  while (stack.length) {
    const node = stack.pop();
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
      if (node.callee.name === name) found.push(node);
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key.endsWith('Comments')) continue;
      const value = node[key];
      for (const child of Array.isArray(value) ? value : [value]) {
        if (typeof child?.type === 'string') stack.push(child);
      }
    }
  }
  return found;
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
    return { statement, decorator, body: declaration.body.body };
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
function membersOf(filename, src, body, modifiers) {
  const members = { props: 'props', environment: 'environment', modifiers: {}, constants: {} };
  for (const member of body) {
    const name = member.key?.name;
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
    } else if (isLiteral(value)) {
      members.constants[name] = src.slice(value.start, value.end);
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

/** A value written out in full: what the extension can have a copy of. */
function isLiteral(node) {
  node = unwrap(node);
  switch (node?.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
      return true;
    case 'TemplateLiteral':
      return node.expressions.length === 0;
    case 'UnaryExpression':
      return node.operator === '-' && node.argument.type === 'NumericLiteral';
    case 'ArrayExpression':
      return node.elements.every(isLiteral);
    case 'ObjectExpression':
      return node.properties.every(
        (p) => p.type === 'ObjectProperty' && !p.computed && isLiteral(p.value),
      );
    default:
      return false;
  }
}

function fail(filename, node, message) {
  throw new LayoutError(
    filename,
    { start: { line: node.loc.start.line - 1, col: node.loc.start.column } },
    message,
  );
}

module.exports = { inlineWidgetLayouts };
