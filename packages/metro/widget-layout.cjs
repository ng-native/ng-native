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
 * - A home-screen widget's `ui-button` records its `target` in the props' `taps` when it is
 *   tapped, since the extension runs the tap while the app may be suspended; `@ng-native/expo/widget`
 *   hands the taps to the app. Its `(buttonPress)` is the props to change at once, as an object.
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
 * The views the widget extension draws (`DynamicView.swift`) that have a typed `ui-*` component, by
 * element: the `@expo/ui` component that draws it, and the inputs of the typed component with how a
 * static attribute is read for each. A view with no typed component is left out, since `ngc`
 * refuses its element in the layout's own template. A `label` input is a string in an app; the extension's component takes a view there, so the string
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
  zstack: { component: 'ZStack', inputs: { alignment: 'string', modifiers: 'any' } },
  rectangle: { component: 'Rectangle', inputs: { modifiers: 'any' } },
  'rounded-rectangle': {
    component: 'RoundedRectangle',
    inputs: { cornerRadius: 'number', modifiers: 'any' },
  },
  'uneven-rounded-rectangle': {
    component: 'UnevenRoundedRectangle',
    inputs: {
      topLeadingRadius: 'number',
      topTrailingRadius: 'number',
      bottomLeadingRadius: 'number',
      bottomTrailingRadius: 'number',
      modifiers: 'any',
    },
  },
  capsule: { component: 'Capsule', inputs: { cornerStyle: 'string', modifiers: 'any' } },
  circle: { component: 'Circle', inputs: { modifiers: 'any' } },
  ellipse: { component: 'Ellipse', inputs: { modifiers: 'any' } },
  'accessory-widget-background': {
    component: 'AccessoryWidgetBackground',
    inputs: { modifiers: 'any' },
  },
  label: {
    component: 'Label',
    inputs: { title: 'string', systemImage: 'string', color: 'string', modifiers: 'any' },
  },
  link: {
    component: 'Link',
    inputs: { destination: 'string', label: 'string', modifiers: 'any' },
  },
  divider: { component: 'Divider', inputs: { modifiers: 'any' } },
  button: {
    component: 'Button',
    inputs: {
      label: 'string',
      systemImage: 'string',
      role: 'string',
      target: 'string',
      modifiers: 'any',
    },
  },
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
  const compiler = new Compiler(file, template, options.at, options.members ?? {});
  return compiler.layout(parsed.nodes);
}

class Compiler {
  constructor(file, template, at, members) {
    this.file = file;
    this.template = template;
    this.at = at;
    this.members = {
      props: members.props ?? 'props',
      environment: members.environment ?? 'environment',
      modifiers: members.modifiers ?? {},
      constants: members.constants ?? {},
    };
    this.fresh = 0;
    /** The slots filled so far. */
    this.filled = new Set();
    /** The temporaries a safe read keeps its receiver in, declared once at the top. */
    this.temporaries = [];
    /** Each constant member as a local of its own, so it hides no global and no other member. */
    this.constants = new Map(
      Object.entries(this.members.constants).map(([name]) => [name, this.local('c')]),
    );
  }

  fail(node, message) {
    throw new LayoutError(this.file, this.spanOf(node), message, this.at);
  }

  /**
   * Where `node` is, as a template node's span gives it. An expression's span is an offset into
   * the template rather than a line and column, so that is worked out from the template's text.
   */
  spanOf(node) {
    const span = node?.sourceSpan ?? node?.span ?? null;
    if (typeof span?.start !== 'number') return span;
    const before = this.template.slice(0, span.start).split('\n');
    return { start: { line: before.length - 1, col: before.at(-1).length } };
  }

  /** A name no template can write, for the loop variables the output introduces. */
  local(hint) {
    return `ɵ${hint}${this.fresh++}`;
  }

  layout(nodes) {
    const scope = new Map();
    const constants = Object.entries(this.members.constants).map(
      ([name, value]) => `var ${this.constants.get(name)}=${value};`,
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
    const temporaries = this.temporaries.length ? `var ${this.temporaries.join(',')};` : '';
    return `function(props,environment){${HELPERS}${temporaries}${constants.join('')}${lets.join('')}return ${body};}`;
  }

  root(nodes, scope) {
    if (nodes.length !== 1) {
      this.fail(nodes[1] ?? null, 'A home-screen widget layout has one root view.');
    }
    this.oneView(nodes, true);
    return this.node(nodes[0], scope);
  }

  /**
   * Refuses what would draw a list of views where the extension draws one: several views, or a
   * `@for`. With `always`, a widget's root, it refuses what could draw nothing too.
   */
  oneView(nodes, always) {
    const views = significant(nodes).filter((node) => !(node instanceof ng.TmplAstLetDeclaration));
    if (views.length > 1)
      this.fail(views[1], 'Draw one view here; put several in a ui-vstack or ui-hstack.');
    const [node] = views;
    if (node instanceof ng.TmplAstForLoopBlock) {
      this.fail(node, '@for draws a list of views here; put it in a ui-vstack or ui-hstack.');
    } else if (node instanceof ng.TmplAstIfBlock) {
      if (always && node.branches.at(-1).expression !== null) {
        this.fail(node, 'A widget always draws a view: give this @if an @else.');
      }
      for (const branch of node.branches) this.oneView(branch.children, always);
    } else if (node instanceof ng.TmplAstSwitchBlock) {
      const cases = casesOf(node);
      if (always && !cases.some((c) => c.expression === null)) {
        this.fail(node, 'A widget always draws a view: give this @switch a @default.');
      }
      for (const c of cases) this.oneView(c.children, always);
    }
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
    if (this.filled.has(reference.name)) {
      this.fail(template, `#${reference.name} is filled twice; a slot draws one layout.`);
    }
    this.filled.add(reference.name);
    this.oneView(template.children, false);
    this.inSlot = true;
    const source = `${reference.name}:${this.children(template.children, scope, true)}`;
    this.inSlot = false;
    return source;
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
    this.refuseUnsupported(node, name === 'button' ? 'buttonPress' : null);
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
    if (name === 'button') props.set('onPress', this.press(node, props, scope));
    const entries = [...props].map(([key, value]) => `${JSON.stringify(key)}:${value}`);
    return `_jsx(${view.component},{${entries.join(',')}})`;
  }

  /** What an element holds, as its `children` prop, or null when it holds nothing. */
  content(node, name, props, scope) {
    if (name === 'text') {
      // `Text` takes its text as children; `text` wins over the content, as in an app.
      const text = props.get('text') ?? this.text(node.children, scope);
      props.delete('text');
      return text;
    }
    const children = this.children(node.children, scope, true);
    return children === 'undefined' ? null : children;
  }

  /**
   * A button's tap, as the function the extension runs: the props it answers replace the widget's,
   * with its target added to `taps`. What `(buttonPress)` answers is merged in first, so the widget
   * can show the tap at once; the taps it holds are kept whatever that answers.
   */
  press(node, props, scope) {
    if (this.inSlot) {
      this.fail(
        node,
        '<ui-button> records its tap in the props, which only a home-screen widget keeps: a Live Activity cannot.',
      );
    }
    const target = props.get('target');
    if (target === undefined) {
      this.fail(node, '<ui-button> needs a target, for the app to tell its taps from the others.');
    }
    const [event] = node.outputs;
    let change = '{}';
    if (event) {
      if (event.handler.ast instanceof ng.Chain) {
        this.fail(
          event,
          '(buttonPress) is one expression in a layout: an object of the props to change.',
        );
      }
      change = this.expression(event.handler, scope);
    }
    const taps = 'Array.isArray(props.taps)?props.taps:[]';
    return `function(){return Object.assign({},props,${change},{taps:(${taps}).concat([${target}])});}`;
  }

  refuseUnsupported(node, event = null) {
    for (const output of node.outputs) {
      if (output.name === event) continue;
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
    if (kind === 'number') {
      const number = numberAttribute(attribute.value);
      if (Number.isNaN(number)) {
        this.fail(attribute, `${attribute.name}="${attribute.value}" is not a number.`);
      }
      return JSON.stringify(number);
    }
    if (kind === 'boolean') return JSON.stringify(attribute.value !== 'false');
    return JSON.stringify(attribute.value);
  }

  /**
   * A `ui-text`'s content as one string expression, or null when it has none. The whitespace at its
   * two ends is dropped once it is joined, as the engine drops it from a `ui-text` in an app.
   */
  text(nodes, scope, outer = true) {
    const parts = [];
    for (const node of nodes) {
      if (node instanceof ng.TmplAstText) parts.push(JSON.stringify(node.value));
      else if (node instanceof ng.TmplAstBoundText) parts.push(this.expression(node.value, scope));
      else if (node instanceof ng.TmplAstIfBlock) {
        parts.push(
          this.ifBlock(
            node,
            scope,
            (b, inner) => this.text(b.children, inner, false) ?? '""',
            '""',
          ),
        );
      } else {
        // The extension's `Text` keeps the strings beside a nested `Text` and drops the view.
        this.fail(
          node,
          'A <ui-text> holds text, interpolations and @if, not views: the widget extension drops a view nested in a text.',
        );
      }
    }
    if (!parts.length) return null;
    return outer ? `String(${parts.join('+')}).trim()` : `(${parts.join('+')})`;
  }

  /**
   * `@if` as a conditional, each branch drawn by `branch(branch, scope)`, and `otherwise` when no
   * branch matches.
   */
  ifBlock(node, scope, branch, otherwise = 'undefined') {
    const branches = [...node.branches];
    let fallback = otherwise;
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
    const cases = casesOf(node);
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
    if (SAFE.has(ast.constructor.name) || (CHAIN.has(ast.constructor.name) && hasSafe(ast))) {
      // As Angular compiles a safe read: a receiver that is null or undefined stops the whole chain
      // after it, and the chain answers null.
      const { guards, expression } = this.chain(ast);
      return `(${guards.join('||')}?null:${expression})`;
    }
    const handler = this[ast.constructor.name];
    if (!handler)
      return this.compiler.fail(
        ast,
        `${ast.constructor.name} is not something a layout expression can do.`,
      );
    return handler.call(this, ast);
  }

  /** A chain of reads and calls, with the guard each safe link in it adds. */
  chain(ast) {
    const kind = ast.constructor.name;
    if (this.chainStart(ast)) return { guards: [], expression: this.write(ast) };
    const receiver = this.chain(ast.receiver ?? ast.expression);
    if (kind === 'NonNullAssert') return receiver;
    const { guards, target } = this.guard(kind, receiver);
    const args = () => ast.args.map((a) => this.write(a)).join(',');
    switch (kind) {
      case 'PropertyRead':
      case 'SafePropertyRead':
        return { guards, expression: `${target}.${ast.name}` };
      case 'KeyedRead':
      case 'SafeKeyedRead':
        return { guards, expression: `${target}[${this.write(ast.key)}]` };
      default:
        return { guards, expression: `${target}(${args()})` };
    }
  }

  /** Where a chain begins: a name, `props()`, or anything that is not a read or a call. */
  chainStart(ast) {
    const kind = ast.constructor.name;
    if (!CHAIN.has(kind) && !SAFE.has(kind)) return true;
    if (kind === 'Call') return this.signalRead(ast) !== null;
    return kind === 'PropertyRead' && isImplicit(ast.receiver);
  }

  /** The guards a link adds to its receiver's, and what the link reads from. */
  guard(kind, receiver) {
    const guards = [...receiver.guards];
    if (kind === 'SafeCall') {
      // ponytail: the callee is read twice, so a method keeps its receiver; it is a read, not a call.
      guards.push(`(${receiver.expression})==null`);
    } else if (SAFE.has(kind)) {
      const temporary = this.compiler.local('t');
      this.compiler.temporaries.push(temporary);
      guards.push(`(${temporary}=${receiver.expression})==null`);
      return { guards, target: temporary };
    }
    return { guards, target: receiver.expression };
  }

  /** `props()` or `environment()`: the parameter itself. */
  signalRead(ast) {
    const { receiver } = ast;
    if (
      !(receiver instanceof ng.PropertyRead) ||
      !isImplicit(receiver.receiver) ||
      ast.args.length
    ) {
      return null;
    }
    const { props, environment } = this.compiler.members;
    if (receiver.name === props) return 'props';
    if (receiver.name === environment) return 'environment';
    return null;
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

  KeyedRead(ast) {
    return `${this.write(ast.receiver)}[${this.write(ast.key)}]`;
  }

  Call(ast) {
    return (
      this.signalRead(ast) ??
      `${this.write(ast.receiver)}(${ast.args.map((a) => this.write(a)).join(',')})`
    );
  }

  Binary(ast) {
    return `(${this.write(ast.left)} ${ast.operation} ${this.write(ast.right)})`;
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

  ThisReceiver(ast) {
    return this.compiler.fail(ast, 'this is not something a layout can read.');
  }

  name(ast) {
    const { name } = ast;
    if (this.scope.has(name)) return this.scope.get(name);
    const { modifiers, constants, props, environment } = this.compiler.members;
    if (Object.hasOwn(modifiers, name)) return modifiers[name];
    if (Object.hasOwn(constants, name)) return this.compiler.constants.get(name);
    if (name === props || name === environment) {
      return this.compiler.fail(ast, `${name} is a signal input: read it as ${name}().`);
    }
    return this.compiler.fail(
      ast,
      `${name} is not a member a layout can read: only props(), environment(), a modifier or a constant.`,
    );
  }
}

/** A `@switch`'s cases, each with what it draws, however this version of Angular groups them. */
function casesOf(node) {
  return (
    node.cases ?? node.groups.flatMap((g) => g.cases.map((c) => ({ ...c, children: g.children })))
  );
}

/** The links of a chain of reads and calls, and the safe ones among them. */
const CHAIN = new Set(['PropertyRead', 'KeyedRead', 'Call', 'NonNullAssert']);
const SAFE = new Set(['SafePropertyRead', 'SafeKeyedRead', 'SafeCall']);

/** Whether a safe link is anywhere along the chain that ends at `ast`. */
function hasSafe(ast) {
  for (let link = ast; link; link = link.receiver ?? link.expression) {
    const kind = link.constructor.name;
    if (SAFE.has(kind)) return true;
    if (!CHAIN.has(kind)) return false;
  }
  return false;
}

const isImplicit = (receiver) =>
  receiver instanceof ng.ImplicitReceiver && !(receiver instanceof ng.ThisReceiver);

/** Nodes with whitespace-only text and comments left out. */
function significant(nodes) {
  return nodes.filter((node) => !(node instanceof ng.TmplAstText && !node.value.trim()));
}

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
