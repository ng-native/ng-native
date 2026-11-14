/**
 * ESLint rules for what compiles in an Angular Native app and does nothing on a device.
 *
 * Angular's compiler checks a template against the browser's DOM schema, so `(click)` on a
 * `<pressable>`, a `<button>` or a `document` read all compile. Here there is no DOM: the event is
 * never sent, the button draws as a plain view and `document` is undefined. Each rule names what
 * to write instead.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import domEvents from '@ng-native/metro/dom-events.cjs';
import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';

/** HTML elements that draw as a plain view or text, without the behaviour they have in a browser. */
const HTML_CONTROLS = new Map([
  ['button', '<pressable>'],
  [
    'a',
    '<text pressable (press)="...">, opening the link with DeepLinks.open from @ng-native/device',
  ],
  ['input', '<text-input>, or <switch> for a checkbox'],
  ['textarea', '<text-input multiline>'],
  ['select', '<ui-picker> from @ng-native/expo'],
  ['option', '<ui-picker> from @ng-native/expo'],
  ['form', 'a <view>, with Signal Forms from @angular/forms/signals'],
  ['img', '<image>'],
  ['picture', '<image>'],
  // No native view stands in for these.
  ...['video', 'audio', 'iframe', 'canvas', 'embed', 'object'].map((name) => [name, null]),
]);

/** Packages that need a browser, or that an app here never has. */
const BROWSER_PACKAGES = new Map([
  ['zone.js', 'signals: an app here is zoneless'],
  ['@angular/platform-browser', 'mount() from @ng-native/platform'],
  ['@angular/platform-browser-dynamic', 'mount() from @ng-native/platform'],
  ['@angular/animations', 'CSS transitions, or the animations in @ng-native/components'],
]);

/** Names imported from a package that need a browser, where the rest of the package does not. */
const BROWSER_IMPORTS = new Map([
  [
    '@angular/common/http',
    new Map([['provideHttpClient', 'provideNativeHttpClient() from @ng-native/platform/http']]),
  ],
  [
    '@angular/core',
    new Map([['provideZoneChangeDetection', 'nothing: an app here is zoneless already']]),
  ],
]);

/**
 * Browser globals that are undefined on a device. `window` is left out: React Native defines it
 * as the global object, so `window.setTimeout` works.
 */
const BROWSER_GLOBALS = new Map([
  ['document', 'the native elements, and a template reference for a node'],
  ['localStorage', 'expo-sqlite/kv-store or another native store'],
  ['sessionStorage', 'a signal or a service'],
  ['indexedDB', 'expo-sqlite'],
  ['location', 'the Router, or DeepLinks from @ng-native/device'],
  ['history', 'the Router'],
  ['matchMedia', '@media in a stylesheet, or Screen and ColorScheme from @ng-native/device'],
  ['getComputedStyle', '(layout) on the element'],
]);

/**
 * Members of a browser's `window` that React Native's `window`, the global object, does not have.
 * `window.document` and the rest of `BROWSER_GLOBALS` are read through it too.
 */
const WINDOW_MEMBERS = new Map([
  ...['addEventListener', 'removeEventListener'].map((name) => [
    name,
    'an event binding, or the services in @ng-native/device',
  ]),
  ...['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight'].map((name) => [
    name,
    'Screen from @ng-native/device',
  ]),
  ...['scrollTo', 'scrollX', 'scrollY', 'pageXOffset', 'pageYOffset'].map((name) => [
    name,
    'a <scroll-view> and its scrollTo() and (scroll)',
  ]),
  ['open', 'DeepLinks.open from @ng-native/device'],
  ['print', 'a native print module'],
]);

/**
 * DOM members an element's `nativeElement` does not have here: it is the engine's node, not an
 * `HTMLElement`. Each with the way to do the same.
 */
const DOM_MEMBERS = new Map([
  ...['focus', 'blur'].map((name) => [
    name,
    `${name}() on the TextInput, from viewChild(TextInput)`,
  ]),
  ...[
    'getBoundingClientRect',
    'getClientRects',
    'offsetWidth',
    'offsetHeight',
    'offsetTop',
    'offsetLeft',
    'clientWidth',
    'clientHeight',
    'scrollWidth',
    'scrollHeight',
  ].map((name) => [name, '(layout) on the element, which carries its size and position']),
  ...['scrollTo', 'scrollBy', 'scrollIntoView', 'scrollTop', 'scrollLeft'].map((name) => [
    name,
    'scrollTo() on the ScrollView, from viewChild(ScrollView)',
  ]),
  ...['addEventListener', 'removeEventListener', 'dispatchEvent'].map((name) => [
    name,
    'an event binding in the template',
  ]),
  ...[
    'classList',
    'className',
    'style',
    'setAttribute',
    'getAttribute',
    'removeAttribute',
    'innerHTML',
    'innerText',
    'textContent',
    'appendChild',
    'removeChild',
    'querySelector',
    'querySelectorAll',
    'closest',
  ].map((name) => [name, 'a binding in the template: [class.name], [style.name] or an input']),
]);

const { DOM_EVENTS, DESKTOP_PLATFORMS, isNativeElement } = domEvents;

/** `expo.platforms` from the `app.json` nearest `directory`, by directory. */
const PLATFORMS = new Map();

/**
 * Whether the project a file is in builds for a desktop OS: one its `app.json` lists in
 * `expo.platforms`. A project with no `app.json`, or none listed, builds for iOS and Android,
 * Expo's default.
 */
function buildsForDesktop(context) {
  const filename = context.physicalFilename ?? context.filename;
  return platformsAbove(dirname(filename)).some((os) => DESKTOP_PLATFORMS.has(os));
}

function platformsAbove(directory) {
  if (PLATFORMS.has(directory)) return PLATFORMS.get(directory);
  const file = join(directory, 'app.json');
  let platforms;
  if (existsSync(file)) {
    try {
      platforms = JSON.parse(readFileSync(file, 'utf8'))?.expo?.platforms;
    } catch {
      platforms = undefined;
    }
  }
  const parent = dirname(directory);
  if (!Array.isArray(platforms)) platforms = parent === directory ? [] : platformsAbove(parent);
  PLATFORMS.set(directory, platforms);
  return platforms;
}

const DOCS = 'https://ng-native.com/packages/eslint-plugin';

/**
 * Whether the file is an Expo DOM component, which starts with `'use dom'` and runs in a web
 * view, where the DOM is real. An inline template is linted as a file of its own, so its
 * component's file is read from disk.
 */
function isDomComponent(context) {
  const { physicalFilename, filename } = context;
  let text = context.sourceCode.text;
  if (physicalFilename !== filename) {
    try {
      text = readFileSync(physicalFilename, 'utf8');
    } catch {
      return false;
    }
  }
  return /^(\s|\/\/.*\n|\/\*[\s\S]*?\*\/)*['"]use dom['"]/.test(text);
}

/** @type {import('eslint').Rule.RuleModule} */
const noDomEvents = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow DOM events no native view sends', url: `${DOCS}#no-dom-events` },
    fixable: 'code',
    hasSuggestions: true,
    messages: {
      changeText: 'Listen for (changeText), which carries the text rather than an event.',
      routerLink:
        'routerLink listens for a DOM click and never navigates on a device. Use nativeRouterLink from @ng-native/router, on a <pressable>.',
      event: '({{name}}) is a DOM event and never fires on a device. Use {{instead}}.',
      desktop:
        '({{name}}) fires only on macOS, and expo.platforms in app.json lists no desktop OS, so it never fires here. Use {{instead}}.',
      global:
        '({{target}}:{{name}}) never fires: there is no {{target}} on a device. Use @ng-native/device for app-wide events.',
    },
    schema: [],
  },
  create(context) {
    if (isDomComponent(context)) return {};
    const desktop = () => buildsForDesktop(context);
    /**
     * Report the event `name` on `target` (a global's name, or null for the element's own), with
     * `fixes` naming the replacement of an event a fix or a suggestion can rename.
     */
    function check(where, target, name, fixes = {}) {
      if (target) {
        context.report({ ...where, messageId: 'global', data: { target, name } });
        return;
      }
      // `(keydown.enter)` is the event `keydown` with a key filter.
      const event = name.split('.')[0];
      const known = DOM_EVENTS.get(event);
      if (!known) return;
      // One a desktop sends is `desktop-only-events`' where the project builds for one.
      if (known.desktop && desktop()) return;
      const messageId = known.desktop ? 'desktop' : 'event';
      const report = { ...where, messageId, data: { name: event, instead: known.instead } };
      if (fixes.press) report.fix = fixes.press;
      if (fixes.changeText) report.suggest = [{ messageId: 'changeText', fix: fixes.changeText }];
      context.report(report);
    }
    return {
      // Angular's RouterLink is a `(click)` listener and an `href`, so it is this rule's too.
      ':matches(TextAttribute, BoundAttribute)[name="routerLink"]'(attribute) {
        context.report({ loc: spanLoc(attribute), messageId: 'routerLink' });
      },
      BoundEvent(event) {
        const element = event.parent?.type === 'Element' ? event.parent : null;
        const native = element && isNativeElement(element.name);
        if (event.target || native) {
          const fixes = element ? renames(context, element, event) : {};
          check({ loc: spanLoc(event) }, event.target, event.name, fixes);
        }
      },
      // A listener in a decorator's `host` object, `'(click)': 'go()'`, is on the host's own view,
      // which is a plain view whatever the selector.
      'Decorator > CallExpression > ObjectExpression > Property[key.name="host"] > ObjectExpression > Property'(
        property,
      ) {
        const key = property.key.type === 'Literal' ? String(property.key.value) : '';
        const listener = /^\((?:(window|document|body):)?([^)]+)\)$/.exec(key);
        if (listener) check({ node: property.key }, listener[1] ?? null, listener[2]);
      },
      'Decorator > CallExpression[callee.name="HostListener"] > Literal:first-child'(literal) {
        const listener = /^(?:(window|document|body):)?(.+)$/.exec(String(literal.value));
        if (listener) check({ node: literal }, listener[1] ?? null, listener[2]);
      },
    };
  },
};

/** @type {import('eslint').Rule.RuleModule} */
const desktopOnlyEvents = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Warn of a DOM event only a desktop OS sends, in a project that builds for one',
      url: `${DOCS}#desktop-only-events`,
    },
    messages: {
      event:
        '({{name}}) fires only on macOS: iOS and Android never send it. Where it has to work there too, use {{instead}} as well.',
    },
    schema: [],
  },
  create(context) {
    if (isDomComponent(context) || !buildsForDesktop(context)) return {};
    const check = (where, name) => {
      const event = name.split('.')[0];
      const known = DOM_EVENTS.get(event);
      if (!known?.desktop) return;
      context.report({
        ...where,
        messageId: 'event',
        data: { name: event, instead: known.instead },
      });
    };
    return {
      BoundEvent(event) {
        const element = event.parent?.type === 'Element' ? event.parent : null;
        if (!event.target && element && isNativeElement(element.name)) {
          check({ loc: spanLoc(event) }, event.name);
        }
      },
      'Decorator > CallExpression > ObjectExpression > Property[key.name="host"] > ObjectExpression > Property'(
        property,
      ) {
        const key = property.key.type === 'Literal' ? String(property.key.value) : '';
        const listener = /^\(([^:)]+)\)$/.exec(key);
        if (listener) check({ node: property.key }, listener[1]);
      },
      'Decorator > CallExpression[callee.name="HostListener"] > Literal:first-child'(literal) {
        const name = String(literal.value);
        if (!name.includes(':')) check({ node: literal }, name);
      },
    };
  },
};

/** @type {import('eslint').Rule.RuleModule} */
const noHtmlControls = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow HTML elements that lose their behaviour on a device',
      url: `${DOCS}#no-html-controls`,
    },
    messages: {
      element: '<{{name}}> draws as a plain view on a device, with no behaviour. Use {{instead}}.',
      none: '<{{name}}> draws as an empty view on a device: nothing in Angular Native draws it.',
    },
    schema: [],
  },
  create(context) {
    if (isDomComponent(context)) return {};
    return {
      Element(element) {
        if (!HTML_CONTROLS.has(element.name)) return;
        const instead = HTML_CONTROLS.get(element.name);
        const data = { name: element.name, instead };
        context.report({ loc: spanLoc(element), messageId: instead ? 'element' : 'none', data });
      },
    };
  },
};

/** @type {import('eslint').Rule.RuleModule} */
const noBrowserApis = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow browser APIs a device does not have',
      url: `${DOCS}#no-browser-apis`,
    },
    messages: {
      package: '{{name}} needs a browser. Use {{instead}}.',
      import: '{{name}} from {{source}} needs a browser. Use {{instead}}.',
      global: '{{name}} is undefined on a device. Use {{instead}}.',
      member: '{{object}}.{{name}} is undefined on a device. Use {{instead}}.',
      nativeHttp: 'Use provideNativeHttpClient from @ng-native/platform/http.',
    },
    hasSuggestions: true,
    schema: [],
  },
  create(context) {
    if (isDomComponent(context)) return {};
    return {
      ImportDeclaration(node) {
        const source = String(node.source.value);
        const pkg = [...BROWSER_PACKAGES.keys()].find(
          (name) => source === name || source.startsWith(`${name}/`),
        );
        if (pkg) {
          const data = { name: pkg, instead: BROWSER_PACKAGES.get(pkg) };
          context.report({ node: node.source, messageId: 'package', data });
          return;
        }
        const names = BROWSER_IMPORTS.get(source);
        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue;
          const name =
            specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : specifier.imported.value;
          const instead = names?.get(name);
          if (!instead) continue;
          const report = { node: specifier, messageId: 'import', data: { name, source, instead } };
          if (name === 'provideHttpClient') {
            report.suggest = [
              {
                messageId: 'nativeHttp',
                fix: (fixer) => toNativeHttp(context, fixer, node, specifier),
              },
            ];
          }
          context.report(report);
        }
      },
      'Program:exit'(program) {
        // A global read is a reference nothing in the file declares: one that resolves to
        // nothing, or to a global the config declares (`globalThis`, or `globals.browser`).
        const scope = context.sourceCode.getScope(program);
        const configured = scope.variables.filter((variable) => variable.defs.length === 0);
        const references = [...scope.through, ...configured.flatMap((one) => one.references)];
        for (const reference of references) {
          const { identifier } = reference;
          const instead = BROWSER_GLOBALS.get(identifier.name);
          if (instead) {
            const data = { name: identifier.name, instead };
            context.report({ node: identifier, messageId: 'global', data });
          } else if (identifier.name === 'window' || identifier.name === 'globalThis') {
            checkWindowMember(context, identifier);
          }
        }
      },
    };
  },
};

/**
 * The fixes that rename a DOM event to the native one, for an element that has it: `(click)` on a
 * `<pressable>`, a `<touchable-opacity>` or a `<text pressable>` is `(press)`, fixed unless the
 * handler reads `$event`, a mouse event there and a native one after; `(input)` on a
 * `<text-input>` is `(changeText)`, only suggested, since its `$event` is the text.
 */
function renames(context, element, event) {
  const { keySpan, handlerSpan } = event;
  if (!keySpan || event.name.includes('.')) return {};
  const range = [keySpan.start.offset, keySpan.end.offset];
  const handler = context.sourceCode.text.slice(handlerSpan.start.offset, handlerSpan.end.offset);
  const pressable =
    element.name === 'pressable' ||
    element.name === 'touchable-opacity' ||
    (element.name === 'text' &&
      [...element.attributes, ...element.inputs].some((one) => one.name === 'pressable'));
  if (event.name === 'click' && pressable && !handler.includes('$event')) {
    return { press: (fixer) => fixer.replaceTextRange(range, 'press') };
  }
  if (event.name === 'input' && element.name === 'text-input') {
    return { changeText: (fixer) => fixer.replaceTextRange(range, 'changeText') };
  }
  return {};
}

/** `ScrollView` as its element's name: `scroll-view`. */
const kebab = (name) => name.replace(/(?<!^)[A-Z]/g, (letter) => `-${letter}`).toLowerCase();

/** @type {import('eslint').Rule.RuleModule} */
const lowercaseElements = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require element names in lowercase, as the components are selected',
      url: `${DOCS}#lowercase-elements`,
    },
    fixable: 'code',
    messages: {
      element: '<{{name}}> matches no component and fails the build. Write <{{lower}}>.',
    },
    schema: [],
  },
  create(context) {
    return {
      Element(element) {
        if (!/^[A-Z]/.test(element.name)) return;
        const lower = kebab(element.name);
        const { startSourceSpan, endSourceSpan } = element;
        // The name starts after `<` in the start tag, and after `</` in an end tag.
        const tags = [startSourceSpan.start.offset + 1];
        if (endSourceSpan && endSourceSpan.start.offset !== startSourceSpan.start.offset) {
          tags.push(endSourceSpan.start.offset + 2);
        }
        context.report({
          loc: spanLoc({ sourceSpan: startSourceSpan }),
          messageId: 'element',
          data: { name: element.name, lower },
          fix: (fixer) =>
            tags.map((at) => fixer.replaceTextRange([at, at + element.name.length], lower)),
        });
      },
    };
  },
};

/** @type {import('eslint').Rule.RuleModule} */
const noDomNodeAccess = {
  meta: {
    type: 'problem',
    docs: {
      description: "Disallow DOM members on an element's nativeElement, which is not a DOM node",
      url: `${DOCS}#no-dom-node-access`,
    },
    messages: {
      member:
        'nativeElement is a native node, not a DOM element: it has no {{name}}. Use {{instead}}.',
    },
    schema: [],
  },
  create(context) {
    if (isDomComponent(context)) return {};
    return {
      // ponytail: reads `x.nativeElement.focus()` written out; a node kept in a variable first is
      // not followed, which would need the type checker.
      'MemberExpression[object.type="MemberExpression"][object.property.name="nativeElement"]'(
        node,
      ) {
        const name =
          node.property.type === 'Identifier' && !node.computed ? node.property.name : '';
        const instead = DOM_MEMBERS.get(name);
        if (instead)
          context.report({ node: node.property, messageId: 'member', data: { name, instead } });
      },
    };
  },
};

/**
 * Whether `node` is read for its truth: the test of an `if`, a loop or a `?:`, the operand of `!`,
 * or an operand of `&&` or `||`, which a condition reads for its truth.
 */
function readAsCondition(node) {
  let at = node;
  while (at.parent?.type === 'ChainExpression') at = at.parent;
  const { parent } = at;
  if (!parent) return false;
  switch (parent.type) {
    case 'IfStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'ForStatement':
    case 'ConditionalExpression':
      return parent.test === at;
    case 'UnaryExpression':
      return parent.operator === '!';
    case 'LogicalExpression':
      return parent.operator === '&&' || parent.operator === '||';
    default:
      return false;
  }
}

/** @type {import('eslint').Rule.RuleModule} */
const noUncalledAvailable = {
  meta: {
    type: 'problem',
    docs: {
      description: "Disallow a service's available signal read as a condition without calling it",
      url: `${DOCS}#no-uncalled-available`,
    },
    messages: {
      uncalled: 'available is a signal, so it is always truthy. Call it: available().',
    },
    fixable: 'code',
    schema: [],
  },
  create(context) {
    return {
      // Every service's `available` is a `Signal<boolean>`: a function, and so always truthy.
      // ponytail: read by name, not by type, so a signal kept under another name is not followed;
      // that would need the type checker, which the recommended config does not set up.
      'MemberExpression[computed=false][property.name="available"]'(node) {
        if (node.parent?.type === 'CallExpression' && node.parent.callee === node) return;
        if (!readAsCondition(node)) return;
        context.report({
          node: node.property,
          messageId: 'uncalled',
          fix: (fixer) => fixer.insertTextAfter(node, '()'),
        });
      },
    };
  },
};

/** Report `window.document`, `globalThis.localStorage`, `window.addEventListener` and the like. */
function checkWindowMember(context, identifier) {
  const member = identifier.parent;
  if (member?.type !== 'MemberExpression' || member.object !== identifier) return;
  const name = member.property.name;
  const instead = BROWSER_GLOBALS.get(name) ?? WINDOW_MEMBERS.get(name);
  if (!instead) return;
  const data = { object: identifier.name, name, instead };
  context.report({ node: member, messageId: 'member', data });
}

/**
 * Swap `provideHttpClient` for `provideNativeHttpClient`: its import from
 * `@ng-native/platform/http`, and each call by the new name. The features it takes are the same.
 */
function toNativeHttp(context, fixer, declaration, specifier) {
  const { sourceCode } = context;
  const local = specifier.local.name;
  const variable = sourceCode.getDeclaredVariables(specifier).find((one) => one.name === local);
  const fixes = (variable?.references ?? []).map((reference) =>
    fixer.replaceText(reference.identifier, 'provideNativeHttpClient'),
  );
  const line = "import { provideNativeHttpClient } from '@ng-native/platform/http';";
  if (declaration.specifiers.length === 1) {
    fixes.push(fixer.replaceText(declaration, line));
    return fixes;
  }
  // The name and the comma after it up to the next name, or the comma before it for the last.
  const after = sourceCode.getTokenAfter(specifier);
  const range =
    after.value === ','
      ? [specifier.range[0], sourceCode.getTokenAfter(after).range[0]]
      : [sourceCode.getTokenBefore(specifier).range[0], specifier.range[1]];
  fixes.push(fixer.removeRange(range));
  fixes.push(fixer.insertTextAfter(declaration, `\n${line}`));
  return fixes;
}

/** An Angular template node's place, as ESLint reads one from angular-eslint's parser. */
function spanLoc(node) {
  const { start, end } = node.sourceSpan;
  return {
    start: { line: start.line + 1, column: start.col },
    end: { line: end.line + 1, column: end.col },
  };
}

const plugin = {
  meta: { name: '@ng-native/eslint-plugin' },
  rules: {
    'no-dom-events': noDomEvents,
    'desktop-only-events': desktopOnlyEvents,
    'no-html-controls': noHtmlControls,
    'no-browser-apis': noBrowserApis,
    'no-dom-node-access': noDomNodeAccess,
    'lowercase-elements': lowercaseElements,
    'no-uncalled-available': noUncalledAvailable,
  },
};

/**
 * The rules on, for an app's TypeScript and its templates, inline ones included. angular-eslint
 * parses the templates and pulls inline ones out of the `.ts` files.
 *
 * @type {import('eslint').Linter.Config[]}
 */
const recommended = [
  {
    name: '@ng-native/recommended/ts',
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@ng-native': plugin },
    processor: angular.processInlineTemplates,
    rules: {
      '@ng-native/no-browser-apis': 'error',
      '@ng-native/no-dom-events': 'error',
      '@ng-native/desktop-only-events': 'warn',
      '@ng-native/no-dom-node-access': 'error',
      '@ng-native/no-uncalled-available': 'error',
    },
  },
  {
    name: '@ng-native/recommended/html',
    files: ['**/*.html'],
    languageOptions: { parser: angular.templateParser },
    plugins: { '@ng-native': plugin },
    rules: {
      '@ng-native/no-dom-events': 'error',
      '@ng-native/desktop-only-events': 'warn',
      '@ng-native/no-html-controls': 'error',
      '@ng-native/lowercase-elements': 'error',
    },
  },
];

export default { ...plugin, configs: { recommended } };
