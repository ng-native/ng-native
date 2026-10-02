/**
 * Compiles a widget layout's Angular template into the function `expo-widgets` evaluates in the
 * widget extension.
 *
 * The extension evaluates a layout's source in a JavaScript context of its own, with `@expo/ui`'s
 * SwiftUI components, its modifiers and a JSX runtime as globals, calls it with the props (and, for
 * a home-screen widget, the environment it is drawn in), and draws the tree it answers: plain
 * `{ type, props }` objects naming native SwiftUI views, which it decodes with the same props
 * classes an app's native views use. Nothing of React runs there. So a template can be compiled to
 * the same source a JSX layout's `'widget'` function becomes, and this does that:
 *
 * - `ui-<name>` elements call the `@expo/ui` component the extension draws that view with, as
 *   `_jsx(Component, props)`, so each component rewrites its props for native as it does for JSX
 *   (an `Image`'s `size` and `color` become modifiers, for one). Each input is the prop of the same
 *   name the typed `ui-*` component takes; a number or a boolean written as a static attribute is
 *   read as that component's transform reads it.
 * - A `ui-text`'s content is its text, as in an app: each run of whitespace collapsed to one space,
 *   as Angular collapses it, and the space at the two ends dropped.
 * - `props()` and `environment()` are the function's parameters, a member standing for a modifier
 *   is the extension's global of that name, and a constant member is inlined.
 * - `@if`, `@for` (with `@empty` and the contextual names), `@switch` and `@let` are expressions.
 * - `<ng-template #slot>` at the top level is one of a Live Activity's slots; otherwise the layout
 *   is a home-screen widget's one root view.
 *
 * Anything a layout cannot do is an error naming the file, line and column, rather than a view the
 * extension draws as an error box on the lock screen.
 */
const ng = require('@angular/compiler');

/**
 * What every compiled layout defines for itself first, since the extension has none of it:
 * children flattened with the empty ones dropped, as native flattens and skips them, and a value
 * interpolated as Angular interpolates it, with null and undefined as nothing.
 */
const HELPERS =
  'function ɵflat(list){var out=[];(function add(v){if(Array.isArray(v))v.forEach(add);else if(v!==undefined&&v!==null&&v!==false)out.push(v);})(list);return out.length===0?undefined:out.length===1?out[0]:out;}' +
  'function ɵstr(v){return v===undefined||v===null?"":String(v);}';

/**
 * The views the widget extension draws (`DynamicView.swift`), by element: the `@expo/ui` component
 * that draws it, and the inputs of the typed `ui-*` component of that name with how a static
 * attribute is read for each. A view with no typed component takes any attribute as a string. A
 * `label` input is a string in an app; the extension's component takes a view there, so the string
 * is drawn as a `Text`.
 */
const VIEWS = {
  text: { component: 'Text', inputs: { text: 'string', modifiers: 'any' } },
  hstack: {
    component: 'HStack',
    inputs: { alignment: 'string', spacing: 'number', modifiers: 'any' },
  },
  vstack: {
    component: 'VStack',
    inputs: { alignment: 'string', spacing: 'number', modifiers: 'any' },
  },
  zstack: { component: 'ZStack' },
  rectangle: { component: 'Rectangle' },
  'rounded-rectangle': { component: 'RoundedRectangle' },
  'uneven-rounded-rectangle': { component: 'UnevenRoundedRectangle' },
  capsule: { component: 'Capsule' },
  circle: { component: 'Circle' },
  ellipse: { component: 'Ellipse' },
  image: {
    component: 'Image',
    inputs: {
      systemName: 'string',
      uiImage: 'string',
      size: 'number',
      color: 'string',
      modifiers: 'any',
    },
  },
  'accessory-widget-background': { component: 'AccessoryWidgetBackground' },
  divider: { component: 'Divider', inputs: { modifiers: 'any' } },
  label: { component: 'Label' },
  progress: { component: 'ProgressView', inputs: { value: 'number', modifiers: 'any' } },
  spacer: { component: 'Spacer', inputs: { modifiers: 'any' } },
  gauge: {
    component: 'Gauge',
    inputs: {
      value: 'number',
      min: 'number',
      max: 'number',
      type: 'string',
      currentValueLabel: 'label',
      minimumValueLabel: 'label',
      maximumValueLabel: 'label',
      modifiers: 'any',
    },
  },
  chart: { component: 'Chart' },
  link: { component: 'Link' },
};

/** The slots a Live Activity's layout fills: the lock screen banner and the Dynamic Island. */
const SLOTS = new Set([
  'banner',
  'compactLeading',
  'compactTrailing',
  'minimal',
  'expandedLeading',
  'expandedTrailing',
  'expandedCenter',
  'expandedBottom',
]);

/** The names `@for` defines beside its item, and what each is. */
const LOOP_CONTEXT = {
  $index: (i) => i,
  $count: (_i, n) => n,
  $first: (i) => `${i}===0`,
  $last: (i, n) => `${i}===${n}-1`,
  $even: (i) => `${i}%2===0`,
  $odd: (i) => `${i}%2===1`,
};

class LayoutError extends Error {
  /**
   * @param {string} file
   * @param {{ start: { line: number, col: number } } | null} span where, from 0, in the template
   * @param {string} message
   * @param {{ line: number, col: number }} [at] where, from 0, the template starts in the file
   */
  constructor(file, span, message, at = { line: 0, col: 0 }) {
    const line = span && span.start.line + at.line;
    const col = span && span.start.col + (span.start.line === 0 ? at.col : 0);
    const where = span ? `${file}:${line + 1}:${col + 1}` : file;
    super(`${where}: ${message}`);
    this.name = 'LayoutError';
  }
}

/**
 * @param {string} template the layout component's template
 * @param {{
 *   file?: string,
 *   at?: { line: number, col: number },
 *   members?: {
 *     props?: string,
 *     environment?: string,
 *     modifiers?: Record<string, string>,
 *     constants?: Record<string, string>,
 *   },
 * }} options the file and where in it, from 0, the template starts, for errors, and the
 *   component's members: the names of its `props` and
 *   `environment` inputs, its members that stand for a modifier (member name to the modifier's
 *   global name), and its constant members (name to the JavaScript source of the value)
 * @returns {string} the source of `function(props, environment) { ... }`
 */
function compileWidgetLayout(template, options = {}) {
  const file = options.file ?? 'layout';
  const parsed = ng.parseTemplate(template, file, { preserveWhitespaces: false });
  if (parsed.errors?.length) {
    const [first] = parsed.errors;
    throw new LayoutError(file, first.span, first.msg, options.at);
  }
  const compiler = new Compiler(file, options.at, options.members ?? {});
  return compiler.layout(parsed.nodes);
}

class Compiler {
  constructor(file, at, members) {
    this.file = file;
    this.at = at;
    this.members = {
      props: members.props ?? 'props',
      environment: members.environment ?? 'environment',
      modifiers: members.modifiers ?? {},
      constants: members.constants ?? {},
    };
    this.fresh = 0;
  }

  fail(node, message) {
    throw new LayoutError(this.file, node?.sourceSpan ?? node?.span ?? null, message, this.at);
  }

  /** A name no template can write, for the loop variables the output introduces. */
  local(hint) {
    return `ɵ${hint}${this.fresh++}`;
  }

  layout(nodes) {
    const scope = new Map();
    const constants = Object.entries(this.members.constants).map(
      ([name, value]) => `var ${name}=${value};`,
    );
    const lets = [];
    const slots = [];
    const roots = [];
    for (const node of significant(nodes)) {
      if (node instanceof ng.TmplAstLetDeclaration) {
        lets.push(this.letDeclaration(node, scope));
      } else if (node instanceof ng.TmplAstTemplate && node.tagName === 'ng-template') {
        slots.push(this.slot(node, scope));
      } else {
        roots.push(node);
      }
    }
    if (slots.length && roots.length) {
      this.fail(
        roots[0],
        'A Live Activity layout holds only @let and <ng-template #slot> at its top.',
      );
    }
    const body = slots.length ? `{${slots.join(',')}}` : this.root(roots, scope);
    return `function(props,environment){${HELPERS}${constants.join('')}${lets.join('')}return ${body};}`;
  }

  root(nodes, scope) {
    if (nodes.length !== 1) {
      this.fail(nodes[1] ?? null, 'A home-screen widget layout has one root view.');
    }
    return this.node(nodes[0], scope);
  }

  slot(template, scope) {
    const [reference] = template.references;
    if (!reference || template.references.length > 1) {
      this.fail(template, 'Name each <ng-template> at the top of a layout with one #slot.');
    }
    if (!SLOTS.has(reference.name)) {
      this.fail(
        template,
        `#${reference.name} is not a Live Activity slot: ${[...SLOTS].join(', ')}.`,
      );
    }
    return `${reference.name}:${this.children(template.children, scope, true)}`;
  }

  letDeclaration(node, scope) {
    const name = this.local(node.name);
    const source = `var ${name}=${this.expression(node.value, scope)};`;
    scope.set(node.name, name);
    return source;
  }

  /** Nodes as a single view, an array of views, or nothing, as the JSX runtime gives them. */
  children(nodes, scope, single) {
    const inner = new Map(scope);
    const lets = [];
    const parts = [];
    for (const node of significant(nodes)) {
      if (node instanceof ng.TmplAstLetDeclaration) lets.push(this.letDeclaration(node, inner));
      else parts.push(this.node(node, inner));
    }
    let value;
    if (!parts.length) value = 'undefined';
    else if (parts.length === 1 && single) value = parts[0];
    else value = `ɵflat([${parts.join(',')}])`;
    return lets.length ? `(function(){${lets.join('')}return ${value};})()` : value;
  }

  node(node, scope) {
    if (node instanceof ng.TmplAstElement) return this.element(node, scope);
    if (node instanceof ng.TmplAstIfBlock) {
      return this.ifBlock(node, scope, (b, inner) => this.children(b.children, inner, true));
    }
    if (node instanceof ng.TmplAstForLoopBlock) return this.forBlock(node, scope);
    if (node instanceof ng.TmplAstSwitchBlock) return this.switchBlock(node, scope);
    if (node instanceof ng.TmplAstContent)
      return this.fail(node, '<ng-content> has nothing to project in a layout.');
    if (node instanceof ng.TmplAstText || node instanceof ng.TmplAstBoundText) {
      return this.fail(node, 'Text goes inside a <ui-text>.');
    }
    return this.fail(node, `${describe(node)} is not something a layout can draw.`);
  }

  element(node, scope) {
    const name = node.name.startsWith('ui-') ? node.name.slice(3) : null;
    if (name === null)
      this.fail(node, `<${node.name}> is not a ui- view, which is all a layout draws.`);
    const view = VIEWS[name];
    if (!view) this.fail(node, `<${node.name}> is not a view the widget extension can draw.`);
    this.refuseUnsupported(node);
    const props = new Map();
    for (const attribute of node.attributes) {
      props.set(attribute.name, this.staticInput(node, view, attribute));
    }
    for (const input of node.inputs) {
      this.knownInput(node, view, input.name, input);
      props.set(input.name, this.expression(input.value, scope));
    }
    for (const [key, value] of props) {
      if (view.inputs?.[key] === 'label') props.set(key, `_jsx(Text,{children:${value}})`);
    }
    const children = this.content(node, name, props, scope);
    if (children !== null) props.set('children', children);
    const entries = [...props].map(([key, value]) => `${JSON.stringify(key)}:${value}`);
    return `_jsx(${view.component},{${entries.join(',')}})`;
  }

  /** What an element holds, as its `children` prop, or null when it holds nothing. */
  content(node, name, props, scope) {
    if (name === 'text') {
      // `Text` takes its text as children; `text` wins over the content, as in an app.
      const text = props.get('text') ?? this.text(trimmed(node.children), scope);
      props.delete('text');
      return text;
    }
    const children = this.children(node.children, scope, true);
    return children === 'undefined' ? null : children;
  }

  refuseUnsupported(node) {
    for (const output of node.outputs) {
      this.fail(output, `(${output.name}) is an event, which a layout cannot run.`);
    }
    for (const reference of node.references) {
      this.fail(reference, `#${reference.name} names a view, which a layout cannot reach.`);
    }
    for (const input of node.inputs) {
      if (input.type !== ng.BindingType.Property) {
        this.fail(
          input,
          `[${input.keySpan?.toString() ?? input.name}] binds a class, a style or an attribute, which a layout cannot.`,
        );
      }
    }
  }

  knownInput(node, view, name, binding) {
    if (view.inputs && !(name in view.inputs)) {
      this.fail(binding, `<${node.name}> has no input ${name}.`);
    }
  }

  staticInput(node, view, attribute) {
    this.knownInput(node, view, attribute.name, attribute);
    const kind = view.inputs?.[attribute.name];
    if (kind === 'number') return JSON.stringify(numberAttribute(attribute.value));
    if (kind === 'boolean') return JSON.stringify(attribute.value !== 'false');
    return JSON.stringify(attribute.value);
  }

  /** A `ui-text`'s content as one string expression, or null when it has none. */
  text(nodes, scope) {
    const parts = [];
    for (const node of nodes) {
      if (node instanceof ng.TmplAstText) parts.push(JSON.stringify(node.value));
      else if (node instanceof ng.TmplAstBoundText) parts.push(this.expression(node.value, scope));
      else if (node instanceof ng.TmplAstIfBlock) {
        parts.push(
          this.ifBlock(node, scope, (b, inner) => this.text(trimmed(b.children), inner) ?? '""'),
        );
      } else {
        // The extension's `Text` keeps the strings beside a nested `Text` and drops the view.
        this.fail(
          node,
          'A <ui-text> holds text, interpolations and @if, not views: the widget extension drops a view nested in a text.',
        );
      }
    }
    return parts.length ? `String(${parts.join('+')})` : null;
  }

  /** `@if` as a conditional, each branch drawn by `branch(branch, scope)`. */
  ifBlock(node, scope, branch) {
    const branches = [...node.branches];
    let fallback = 'undefined';
    if (branches.length > 1 && branches.at(-1).expression === null) {
      fallback = branch(branches.pop(), scope);
    }
    return branches.reduceRight((otherwise, b) => {
      const condition = this.expression(b.expression, scope);
      if (!b.expressionAlias) return `(${condition}?${branch(b, scope)}:${otherwise})`;
      const alias = this.local(b.expressionAlias.name);
      const inner = new Map(scope).set(b.expressionAlias.name, alias);
      return `(function(${alias}){return ${alias}?${branch(b, inner)}:${otherwise};})(${condition})`;
    }, fallback);
  }

  forBlock(node, scope) {
    const item = this.local(node.item.name);
    const index = this.local('i');
    const items = this.local('items');
    const inner = new Map(scope);
    inner.set(node.item.name, item);
    for (const variable of node.contextVariables) {
      const make = LOOP_CONTEXT[variable.value];
      if (!make) continue;
      inner.set(variable.name, `(${make(index, `${items}.length`)})`);
    }
    const body = this.children(node.children, inner, true);
    const empty = node.empty ? this.children(node.empty.children, scope, true) : 'undefined';
    return (
      `(function(${items}){return ${items}.length?ɵflat(${items}.map(function(${item},${index}){return ${body};})):${empty};})` +
      `(Array.from(${this.expression(node.expression, scope)}??[]))`
    );
  }

  switchBlock(node, scope) {
    const subject = this.local('case');
    const cases =
      node.cases ??
      node.groups?.flatMap((g) => g.cases.map((c) => ({ ...c, children: g.children })));
    let fallback = 'undefined';
    const tests = [];
    for (const c of cases) {
      const view = this.children(c.children, scope, true);
      if (c.expression === null) fallback = view;
      else tests.push([this.expression(c.expression, scope), view]);
    }
    const chain = tests.reduceRight(
      (otherwise, [value, view]) => `${subject}===${value}?${view}:${otherwise}`,
      fallback,
    );
    return `(function(${subject}){return ${chain};})(${this.expression(node.expression, scope)})`;
  }

  expression(ast, scope) {
    return new ExpressionWriter(this, scope).write(ast);
  }
}

/** Angular expressions as JavaScript, with the names a layout can read resolved. */
class ExpressionWriter {
  constructor(compiler, scope) {
    this.compiler = compiler;
    this.scope = scope;
  }

  write(ast) {
    const handler = this[ast.constructor.name];
    if (!handler)
      return this.compiler.fail(
        ast,
        `${ast.constructor.name} is not something a layout expression can do.`,
      );
    return handler.call(this, ast);
  }

  ASTWithSource(ast) {
    return this.write(ast.ast);
  }

  Interpolation(ast) {
    const parts = [];
    ast.strings.forEach((text, i) => {
      if (text) parts.push(JSON.stringify(text));
      if (i < ast.expressions.length) parts.push(`ɵstr(${this.write(ast.expressions[i])})`);
    });
    return parts.length ? `(${parts.join('+')})` : '""';
  }

  LiteralPrimitive(ast) {
    return ast.value === undefined ? 'undefined' : JSON.stringify(ast.value);
  }

  LiteralArray(ast) {
    return `[${ast.expressions.map((e) => this.write(e)).join(',')}]`;
  }

  LiteralMap(ast) {
    const entries = ast.keys.map((key, i) => {
      if (key.kind === 'spread') return `...${this.write(ast.values[i])}`;
      return `${JSON.stringify(key.key)}:${this.write(ast.values[i])}`;
    });
    return `{${entries.join(',')}}`;
  }

  TemplateLiteral(ast) {
    const parts = ast.elements.map((element, i) => {
      const text = element.text.replace(/[`\\$]/g, (c) => `\\${c}`);
      return i < ast.expressions.length ? `${text}\${${this.write(ast.expressions[i])}}` : text;
    });
    return `\`${parts.join('')}\``;
  }

  PropertyRead(ast) {
    if (isImplicit(ast.receiver)) return this.name(ast);
    return `${this.write(ast.receiver)}.${ast.name}`;
  }

  SafePropertyRead(ast) {
    return `${this.write(ast.receiver)}?.${ast.name}`;
  }

  KeyedRead(ast) {
    return `${this.write(ast.receiver)}[${this.write(ast.key)}]`;
  }

  SafeKeyedRead(ast) {
    return `${this.write(ast.receiver)}?.[${this.write(ast.key)}]`;
  }

  Call(ast) {
    const { receiver } = ast;
    if (receiver instanceof ng.PropertyRead && isImplicit(receiver.receiver)) {
      const { props, environment } = this.compiler.members;
      if (receiver.name === props && !ast.args.length) return 'props';
      if (receiver.name === environment && !ast.args.length) return 'environment';
    }
    return `${this.write(receiver)}(${ast.args.map((a) => this.write(a)).join(',')})`;
  }

  SafeCall(ast) {
    return `${this.write(ast.receiver)}?.(${ast.args.map((a) => this.write(a)).join(',')})`;
  }

  Binary(ast) {
    return `(${this.write(ast.left)}${ast.operation}${this.write(ast.right)})`;
  }

  Conditional(ast) {
    return `(${this.write(ast.condition)}?${this.write(ast.trueExp)}:${this.write(ast.falseExp)})`;
  }

  PrefixNot(ast) {
    return `(!${this.write(ast.expression)})`;
  }

  TypeofExpression(ast) {
    return `(typeof ${this.write(ast.expression)})`;
  }

  VoidExpression(ast) {
    return `(void ${this.write(ast.expression)})`;
  }

  Unary(ast) {
    return `(${ast.operator}${this.write(ast.expr)})`;
  }

  NonNullAssert(ast) {
    return this.write(ast.expression);
  }

  ParenthesizedExpression(ast) {
    return `(${this.write(ast.expression)})`;
  }

  BindingPipe(ast) {
    return this.compiler.fail(
      ast,
      `The ${ast.name} pipe has nothing to run it in a layout; work the value out in the props.`,
    );
  }

  ThisReceiver() {
    return this.compiler.fail(null, 'this is not something a layout can read.');
  }

  name(ast) {
    const { name } = ast;
    if (this.scope.has(name)) return this.scope.get(name);
    const { modifiers, constants, props, environment } = this.compiler.members;
    if (name in modifiers) return modifiers[name];
    if (name in constants) return name;
    if (name === props || name === environment) {
      return this.compiler.fail(ast, `${name} is a signal input: read it as ${name}().`);
    }
    return this.compiler.fail(
      ast,
      `${name} is not a member a layout can read: only props(), environment(), a modifier or a constant.`,
    );
  }
}

const isImplicit = (receiver) =>
  receiver instanceof ng.ImplicitReceiver && !(receiver instanceof ng.ThisReceiver);

/** Nodes with whitespace-only text and comments left out. */
function significant(nodes) {
  return nodes.filter((node) => !(node instanceof ng.TmplAstText && !node.value.trim()));
}

/**
 * A text view's content with the whitespace at its two ends dropped, as the engine drops it from a
 * `ui-text` in an app, and every space inside kept.
 */
function trimmed(nodes) {
  const kids = [...nodes];
  const edge = (index, trim) => {
    const node = kids[index];
    if (node instanceof ng.TmplAstText) {
      kids[index] = new ng.TmplAstText(trim(node.value), node.sourceSpan);
    } else if (node instanceof ng.TmplAstBoundText) {
      const ast = node.value.ast;
      const strings = [...ast.strings];
      const at = trim === trimStart ? 0 : strings.length - 1;
      strings[at] = trim(strings[at]);
      const interpolation = Object.assign(Object.create(Object.getPrototypeOf(ast)), ast, {
        strings,
      });
      const value = Object.assign(Object.create(Object.getPrototypeOf(node.value)), node.value, {
        ast: interpolation,
      });
      kids[index] = Object.assign(Object.create(Object.getPrototypeOf(node)), node, { value });
    }
  };
  if (kids.length) {
    edge(0, trimStart);
    edge(kids.length - 1, trimEnd);
  }
  return kids.filter((node) => !(node instanceof ng.TmplAstText && node.value === ''));
}

const trimStart = (text) => text.replace(/^\s+/, '');
const trimEnd = (text) => text.replace(/\s+$/, '');

/** What `numberAttribute` makes of an attribute: a number, or NaN for text that is not one. */
function numberAttribute(value) {
  return !Number.isNaN(Number.parseFloat(value)) && Number.isFinite(Number(value))
    ? Number(value)
    : NaN;
}

function describe(node) {
  return node.name ? `<${node.name}>` : node.constructor.name.replace(/^TmplAst/, '');
}

module.exports = { compileWidgetLayout, LayoutError, VIEWS, SLOTS };
