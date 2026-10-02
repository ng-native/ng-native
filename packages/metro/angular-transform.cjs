/**
 * The Angular half of the Metro pipeline, shared by the Metro transformer and the test
 * helper so the two cannot drift.
 *
 * This is a chain, not a replacement: `transformAngularFileSync` compiles templates but
 * leaves TypeScript syntax in its output, so a JS/TS transform still has to run afterwards.
 *
 * `@oxc-angular/vite` is ESM with no `main`, so this relies on Node's require(esm)
 * (Node 22.12+).
 */
const { createHash } = require('node:crypto');
const { existsSync, readdirSync, readFileSync, statSync } = require('node:fs');
const path = require('node:path');
const { compileError } = require('./compile-error.cjs');
const { assertTemplateFileParses, assertTemplatesParse } = require('./template-syntax.cjs');
const { compileCss } = require('./css/compile.cjs');
const { assertStylesRead } = require('./styles-expression.cjs');
const { componentDeclarations } = require('./component-declarations.cjs');
const {
  compileForHmrSync,
  extractComponentMetadataSync,
  linkAngularPackageSync,
  transformAngularFileSync,
} = require('@oxc-angular/vite/api');

const IS_SOURCE = /\.m?tsx?$/;
const HAS_ANGULAR_DECORATOR = /@(Component|Directive|Pipe|Injectable|NgModule|Service)\s*\(/;
const IS_PARTIAL_COMPILED =
  /ɵɵngDeclare(Component|Directive|Pipe|Injectable|NgModule|Service|Factory)/;
const IS_STYLE = /\.(css|scss|sass|less)$/;

/** Files an Angular component can pull in that are not JavaScript. */
const RESOURCE_EXTENSIONS = ['.html', '.css', '.scss', '.sass', '.less'];

function isResource(filename) {
  return RESOURCE_EXTENSIONS.some((extension) => filename.endsWith(extension));
}

/**
 * A leading-capital element name compiles to an empty template with zero errors and a
 * valid-looking ɵcmp: a blank screen on a green build. Turn it into a build failure.
 *
 * Checked per component, not per file. A file can hold several components, and one of them
 * legitimately having an empty template (a leaf primitive with no children) must not condemn
 * its neighbours - which it did, until it bit.
 */
function assertTemplatesCompiled(code, src, filename, components) {
  const decls = [...code.matchAll(/decls:\s*(\d+)/g)].map((match) => match[1]);
  if (!decls.length || !decls.includes('0')) return;

  // Emitted definitions follow source order, so the two lists line up.
  const paired = components && components.length === decls.length;
  for (let i = 0; i < decls.length; i++) {
    if (decls[i] !== '0') continue;

    const template = paired ? (components[i].template ?? '') : src;
    if (!template.includes('<')) continue; // genuinely has nothing to render

    const name = paired ? components[i].className : filename;
    const capitalized = /<([A-Z][A-Za-z0-9]*)[\s/>]/.exec(template);
    throw new Error(
      `${filename}: ${name}'s template compiled to nothing (decls: 0).` +
        (capitalized
          ? ` Element <${capitalized[1]}> is capitalized; element names must be lowercase.`
          : ' Check for a leading-capital element name.'),
    );
  }
}

/**
 * `@oxc-angular/vite` (through 0.0.39, the newest release as this was written) mis-emits an
 * object method shorthand found inside decorator metadata - `providers: [{ useValue: {
 * attach() {} } }]`, or the same shape in `host` - dropping the `function`/`async`/`get` keyword
 * the shorthand implies. The compiler reports zero errors; the result is not valid JavaScript,
 * so it only fails later, cryptically, wherever the module is parsed.
 *
 * `identifier:(params) {` is never valid output otherwise: a real function value always carries
 * either `function` before the parameter list or `=>` after it, and a class's own method syntax
 * has no colon before the parameter list. Turn the silent bad output into a clear, immediate
 * build failure naming the fix, rather than a `SyntaxError` with no context downstream.
 */
const BROKEN_METHOD_SHORTHAND = /([A-Za-z_$][\w$]*)\s*:\s*\(([^()]*)\)\s*\{/;

function assertNoBrokenMethodShorthand(code, filename) {
  const match = BROKEN_METHOD_SHORTHAND.exec(code);
  if (!match) return;

  const [, key, params] = match;
  throw new Error(
    `${filename}: a method shorthand inside this component's decorator metadata (for example, ` +
      `in "providers" or "host") compiled to invalid code: "${key}:(${params}) {" is not valid ` +
      'JavaScript. This is a known @oxc-angular/vite bug (confirmed through 0.0.39): it drops the ' +
      '"function"/"async"/"get" keyword when re-emitting a method shorthand found in decorator ' +
      `metadata. Work around it by writing the value explicitly instead of shorthand - ` +
      `"${key}: function (${params}) { ... }" rather than "${key}(${params}) { ... }".`,
  );
}

/**
 * `@oxc-angular/vite` (through 0.0.39) resolves a template arrow function's own parameter against
 * the component: `(o) => !o` compiles to `(o) => !ctx.o`, which reads `undefined` at runtime with
 * no error from the compiler. Angular itself scopes the parameter correctly.
 *
 * `ctx.` is how compiled template code reaches the component, so `(x) => ... ctx.x` in the output
 * is this bug and nothing else: an arrow the author wrote in TypeScript never says `ctx`.
 *
 * ponytail: the body scan stops at the first `;` or line break, which covers what a template
 * expression compiles to; a multi-line arrow body would slip past.
 */
const ARROW = /\(([\w$\s,]*)\)\s*=>([^;\n]*)/g;

function assertNoShadowedArrowParameters(code, filename) {
  for (const [, list, body] of code.matchAll(ARROW)) {
    const parameter = list
      .split(',')
      .map((name) => name.trim())
      .find((name) => name && new RegExp(`\\bctx\\.${name.replace(/\$/g, '\\$')}\\b`).test(body));
    if (!parameter) continue;
    throw new Error(
      `${filename}: an arrow function in this component's template reads its own parameter ` +
        `"${parameter}", and it compiled as the component's "${parameter}" instead. This is a known ` +
        '@oxc-angular/vite bug (confirmed through 0.0.39). Move the logic into a component ' +
        'method and call that from the template.',
    );
  }
}

/**
 * A `templateUrl` or `styleUrl` as an import Metro resolves beside the component. Angular reads
 * `'x.html'` as relative, the way it reads `'./x.html'`; an import of `"x.html"` names a package.
 */
function relativeSpecifier(url) {
  return /^\.\.?[\\/]/.test(url) || path.isAbsolute(url) ? url : `./${url}`;
}

function readResources(dependencies, filename) {
  const directory = path.dirname(filename);
  const templates = {};
  const styles = {};
  for (const dependency of dependencies) {
    const resolved = path.resolve(directory, dependency);
    const content = readFileSync(resolved, 'utf8');
    if (IS_STYLE.test(dependency)) styles[dependency] = [content];
    else templates[dependency] = content;
  }
  return { templates, styles };
}

/**
 * Empty the `styles: [...]` Angular compiles into a component definition.
 *
 * Nothing reads it. The host that would apply those strings lives in `platform-browser`, which
 * this project does not use, and the styling that does apply comes from the compiled rule set on
 * `ɵnativeStyles`. Left in, it was 8.6% of the canary's emitted component code, and a minifier
 * cannot prove it dead because it is a property of an object handed to a function.
 *
 * Only the definition's own `styles` property, read with a parser (`component-declarations.cjs`):
 * an input whose class field is called `styles` sits in the same definition, and a template's text
 * can read like the property, and both are the component's. The property is emptied rather than
 * removed, because the shape of the definition is Angular's to decide and an absent key and an
 * empty one are not always the same thing. A module that does not parse keeps its CSS: it is only
 * weight, and the bundler reports the syntax error itself.
 */
function stripComponentStyles(code, filename) {
  const declarations = componentDeclarations(code, filename, 'ɵɵdefineComponent') ?? [];
  let out = code;
  for (const { styles } of declarations.sort((a, b) => b.start - a.start)) {
    if (styles?.entries?.length) out = out.slice(0, styles.start) + '[]' + out.slice(styles.end);
  }
  return out;
}

/** Throw the compiler's errors, placed in the template they are about where that can be told. */
function fail(result, src, filename, resources) {
  if (!result.errors.length) return;
  let components = [];
  try {
    components = extractComponentMetadataSync(src, filename);
  } catch {
    // Only used to name the component an error is in; the error itself is the one to report.
  }
  throw compileError(result.errors, filename, src, components, resources?.templates ?? {});
}

const hash = (value) => createHash('sha1').update(value).digest('hex').slice(0, 12);

/**
 * Angular HMR, without Angular's dev server.
 *
 * The compiler can generate the "update metadata" module that `ɵɵreplaceMetadata` expects - a
 * function that re-applies a component's template onto an existing class, re-rendering every
 * live instance. Angular's own wiring fetches that module over HTTP from a Vite middleware
 * (`ɵɵgetReplaceMetadataURL` -> `import(url)`), which Metro and Hermes cannot do.
 *
 * They do not have to. Metro already ships changed modules to the device and re-runs them, so
 * the update function is embedded in the module itself. On re-evaluation the module patches the
 * *original* class, which is the one live views still point at, and calls `module.hot.accept()`
 * so Metro stops bubbling there instead of reloading the app.
 *
 * Only the template and the inline styles can be swapped this way. Anything else - a new method,
 * a changed selector, different imports - is not expressible as a metadata replacement, so the
 * block falls back to a full reload. It decides by comparing two hashes: the template and styles,
 * and the file with every template and inline style removed.
 *
 * An external template or stylesheet is swapped by its own module instead: see `resourceBlock`.
 */
function hmrBlock(src, filename, components, resources, options, warn) {
  if (!components?.length) return '';

  // The "shape" is everything a metadata swap cannot express: the file with every template and
  // inline style stripped out. If that moves, only a reload can apply the change.
  const shapeSource = withoutSwappable(src, components);

  const applies = [];
  const defs = [];
  for (const component of components) {
    const template = component.template ?? resources?.templates?.[component.templateUrl];
    if (template === undefined) continue;

    const update = hotUpdate(template, component, filename, options);
    if (!update) continue;

    applies.push(update.apply);
    const parts = componentParts(component, resources, filename, src);
    const css = parts.map((part) => part.text).join('\n');
    const sheet = componentSheet(
      css,
      filename,
      component.className,
      options?.platform,
      parts,
      warn,
    );
    defs.push(
      `{ id: ${JSON.stringify(update.id)}, type: ${component.className}, ` +
        `template: ${JSON.stringify(hash(template))}, styles: ${JSON.stringify(hash(css))}, ` +
        `sheet: ${sheet ? literal(sheet) : 'null'}, apply: ${update.name} }`,
    );
  }

  if (!defs.length) return '';

  return `
if (typeof ngDevMode === "undefined" || ngDevMode) {
${applies.join('\n')}
(function () {
  var registry = (globalThis.__angularNativeHmr ||= new Map());
  var pending = (globalThis.__angularNativeHmrPending ||= new Map());
  var file = ${JSON.stringify(filename)};
  var shape = ${JSON.stringify(hash(shapeSource))};
  var source = ${JSON.stringify(hash(src))};
  var defs = [${defs.join(', ')}];
  var previous = registry.get(file);
  // One line per save, and it says why a reload happened when state gets lost.
  var log = console.log;
${SWAP}
  var reload = false;

  if (!previous) {
    var entry = {
      shape: shape,
      source: source,
      types: new Map(defs.map(function (d) { return [d.id, d.type]; })),
      templates: new Map(defs.map(function (d) { return [d.id, d.template]; })),
      styles: new Map(defs.map(function (d) { return [d.id, d.styles]; })),
    };
    registry.set(file, entry);
    log("[angular-native] hmr registered", file);
    // An external template's module ran before this one, and may know better. After a reload
    // Metro serves this module from its cache, compiled against the template as it was when this
    // file last changed, while the template's own module was re-transformed on the edit.
    //
    // Only when it was compiled against this file as it is, though. If this file is the one that
    // changed, it is the resource's module that Metro served from its cache, holding this
    // component's template and styles from before the edit, and swapping them in would undo it.
    for (var j = 0; j < defs.length; j++) {
      var waiting = pending.get(defs[j].id);
      if (!waiting) continue;
      pending.delete(defs[j].id);
      if (waiting.source !== source) continue;
      swap(entry, waiting);
    }
  } else if (previous.source === source) {
    // This module's own code is unchanged, so we were only re-run as the nearest accepting
    // module for a dependency's update. That is not something a template swap can express.
    log("[angular-native] hmr reload: a dependency changed", file);
    reload = true;
  } else if (previous.shape !== shape) {
    log("[angular-native] hmr reload: more than the template changed", file);
    reload = true;
  } else {
    previous.source = source;
    for (var i = 0; i < defs.length; i++) {
      // Siblings in the same file whose template and styles did not move are simply left alone.
      if (!swap(previous, defs[i])) reload = true;
    }
  }

  // Accept only what was actually applied. Accepting an update we could not apply tells Metro the
  // change has landed, so it stops bubbling and never falls back - which is how an edit could ship
  // and change nothing. Leaving it unaccepted lets Metro reload the app itself, at the point it
  // knows the new bundle is ready. Reloading from here instead raced that: the app came back
  // holding the bundle from before the edit.
  if (reload) (globalThis.__angularNativeReload || function () {})(file);
  else if (typeof module !== "undefined" && module.hot) module.hot.accept();
})();
}
`;
}

/**
 * The decorator properties a hot swap can carry, whose literal values the shape leaves out. A
 * style swaps as the compiled sheet the def carries, a template as its update function.
 */
const SWAPPABLE = /\b(?:template|styles)\s*:\s*/g;

/**
 * The file with the literal value of every swappable property in a component decorator cut out.
 *
 * Cut by position, as written, rather than by searching for the value the compiler read: a
 * template with an escape in it, `'it\'s'`, is not written the way it reads, so a search for it
 * found nothing and every edit to that template reloaded the app. Only the decorator is looked
 * in, from its `@Component` to the class it decorates, so an object of the author's own with a
 * `template` key is still part of the shape.
 */
function withoutSwappable(src, components) {
  let out = '';
  let from = 0;
  for (const component of [...components].sort((a, b) => a.spanStart - b.spanStart)) {
    const decorator = src.lastIndexOf('@Component', component.spanStart);
    if (decorator < from) continue;
    out += src.slice(from, decorator) + withoutLiterals(src.slice(decorator, component.spanStart));
    from = component.spanStart;
  }
  return out + src.slice(from);
}

function withoutLiterals(decorator) {
  let out = '';
  let from = 0;
  SWAPPABLE.lastIndex = 0;
  for (let match = SWAPPABLE.exec(decorator); match; match = SWAPPABLE.exec(decorator)) {
    const at = match.index + match[0].length;
    const end = literalEnd(decorator, at);
    if (end === -1) continue;
    out += decorator.slice(from, at);
    from = end;
    SWAPPABLE.lastIndex = end;
  }
  return out + decorator.slice(from);
}

/**
 * Index just past the string literal, or the array of nothing but string literals, starting at
 * `at`; -1 for anything else, which stays in the shape.
 */
function literalEnd(code, at) {
  if (code[at] !== '[') return stringEnd(code, at);
  for (let i = at + 1; i < code.length;) {
    if (/[\s,]/.test(code[i])) i++;
    else if (code[i] === ']') return i + 1;
    else if ((i = stringEnd(code, i)) === -1) return -1;
  }
  return -1;
}

function stringEnd(code, at) {
  const quote = code[at];
  if (quote !== '"' && quote !== "'" && quote !== '`') return -1;
  for (let i = at + 1; i < code.length; i++) {
    if (code[i] === '\\') i++;
    else if (code[i] === quote) return i + 1;
  }
  return -1;
}

/**
 * Patch one live component from a def, when its template or its sheet moved. Shared by the
 * component's own block and a resource's, so the two cannot disagree about what "moved" means.
 *
 * The sheet is only compared when the def carries one. A component's own block leaves it out of
 * a first registration, because a module served from Metro's cache after a reload cannot tell a
 * stylesheet edit from its stale copy of the old one; it carries it on an update, which only runs
 * when the module was re-transformed and so read every stylesheet as it is now. Swapping the sheet re-applies the template as well, because that is what recreates the views,
 * and a recreated view asks the renderer factory for the component's sheet again.
 */
const SWAP = `
  function swap(entry, def) {
    var type = entry.types.get(def.id);
    if (!type) return false;
    var template = entry.templates.get(def.id) !== def.template;
    var styles = "sheet" in def && entry.styles.get(def.id) !== def.styles;
    if (!template && !styles) return true;
    if (styles) type["ɵnativeStyles"] = def.sheet || undefined;
    console.log("[angular-native] hot " + (template ? "template" : "style") + " swap", def.id);
    try {
      i0.ɵɵreplaceMetadata(type, def.apply, [i0], [], undefined, def.id);
    } catch (error) {
      // The view being rebuilt is already in the tree, half made, and would throw on every
      // change detection from here on. Only a reload gets the screen back.
      console.error("[angular-native] hot swap failed, reloading", def.id, error);
      return false;
    }
    entry.templates.set(def.id, def.template);
    if ("sheet" in def) entry.styles.set(def.id, def.styles);
    return true;
  }
`;

/**
 * One line, run before the compiled class, that keeps a hot swap from reporting NG0912.
 *
 * Metro applies an update by re-running the whole file, so each component in it is defined a
 * second time with the id it had before, and Angular warns about a collision on every save. It is
 * the same component, about to be patched onto the live class by the HMR block. Only a file that
 * is already registered - an update, not a first load - is quietened, only for its own components,
 * and only until the module has finished running, which is synchronous: the next microtask.
 */
function collisionQuiet(filename, components) {
  const names = JSON.stringify(components.map((component) => `'${component.className}'`));
  return (
    `if ((typeof ngDevMode === "undefined" || ngDevMode) && globalThis.__angularNativeHmr?.has(` +
    `${JSON.stringify(filename)})) { const warn = console.warn; const names = ${names}; ` +
    `console.warn = function (message) { if (typeof message === "string" && ` +
    `message.includes("NG0912") && names.some((name) => message.includes(name))) return; ` +
    `return warn.apply(console, arguments); }; Promise.resolve().then(() => { console.warn = warn; }); }\n`
  );
}

/**
 * The update-metadata function for one component's template, named for it.
 *
 * The compiler's update function spreads the live definition and replaces the template, but
 * leaves `decls`, `vars` and `ngContentSelectors` as they were (`@oxc-angular/vite` 0.0.38). Those
 * size the view the swap rebuilds, so a template that gained an element or a binding ran off the
 * end of a view laid out for the one before it: an assertion halfway through the swap, and a
 * half-built view left in the tree. So they are read off a full compile of the same template and
 * written in after the spread. Anything that cannot be read that way is no swap at all, which the
 * caller turns into a reload.
 */
function hotUpdate(template, component, filename, options) {
  // The compiler builds a `path@ClassName` id and reads the class name back from the first `@`,
  // so a scoped package's `node_modules/@scope/...` path named the update function after the
  // path. The id only has to agree with itself, so the `@` goes.
  const file = filename.replaceAll('@', '_');
  const result = compileForHmrSync(
    template,
    component.className,
    file,
    component.styles ?? null,
    options,
  );
  if (result.errors.length) return null;
  const layout = templateLayout(template, component.className, file, options);
  const spread = `...${component.className}.ɵcmp,`;
  if (!layout || !result.hmrModule.includes(spread)) return null;
  const name = `${component.className}_ApplyMetadata`;
  return {
    id: result.componentId,
    name,
    apply: result.hmrModule
      .replace(/export\s+default\s+function\s+\w+/, `function ${name}`)
      .replace(spread, `${spread} ${layout}`),
  };
}

/**
 * The definition fields a template decides and the update function leaves out, as source: its
 * slot and binding counts and its projection selectors, from compiling it as a component alone.
 */
function templateLayout(template, className, filename, options) {
  const { platform, ...rest } = options ?? {};
  const probe = transformAngularFileSync(
    `import { Component } from '@angular/core';\n` +
      `@Component({ selector: 'hmr-layout', template: ${JSON.stringify(template)} })\n` +
      `export class ${className} {}\n`,
    filename,
    { ...rest, emitClassMetadata: false, sourcemap: false },
  );
  if (probe.errors?.length) return null;
  const counts = /\bdecls:(\d+),\s*vars:(\d+)/.exec(probe.code);
  if (!counts) return null;
  let selectors = 'undefined';
  const projected = /\bngContentSelectors:(_c\d+)/.exec(probe.code);
  if (projected) {
    const constant = new RegExp(`\\bconst ${projected[1]} = (\\[[^;]*\\]);`).exec(probe.code);
    if (!constant) return null;
    selectors = constant[1];
  }
  return `decls: ${counts[1]}, vars: ${counts[2]}, ngContentSelectors: ${selectors},`;
}

/**
 * The components that use an external resource, found from the resource's side.
 *
 * Metro hands a transform the one file and nothing about who imports it, so the owners are found
 * the way a reader would: the sources in the project that name it in a `templateUrl` or
 * `styleUrl`. The whole project, not the resource's own directory, because a stylesheet shared by
 * several screens sits above them and each reaches it with `../`; found only beside itself, it
 * carried no update, the edit bubbled to each screen's cached module, and the app reloaded with
 * the old styles.
 */
function ownersOf(resource) {
  // Metro names files relative to the project root, which is also the worker's directory, so a
  // relative resource gets its owners named the same way, and everything compares resolved.
  const target = path.resolve(resource);
  const name = path.basename(resource);
  const owners = [];

  for (const absolute of sourceFiles(projectRoot(target))) {
    const src = sourceOf(absolute);
    if (!src.includes(name) || !HAS_ANGULAR_DECORATOR.test(src)) continue;

    const file = path.isAbsolute(resource) ? absolute : path.relative(process.cwd(), absolute);
    const directory = path.dirname(absolute);
    const components = extractComponentMetadataSync(src, file).filter((component) =>
      [component.templateUrl, ...(component.styleUrls ?? [])].some(
        (url) => url && path.resolve(directory, url) === target,
      ),
    );
    if (components.length) owners.push({ file, src, components });
  }
  return owners;
}

/** The project a file is in: the nearest directory above it with a `package.json`. */
function projectRoot(file) {
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    if (existsSync(path.join(directory, 'package.json'))) return directory;
    if (path.dirname(directory) === directory) return path.dirname(file);
  }
}

/** Directories no component lives in: dependencies, native projects and build output. */
const NOT_SOURCE = new Set(['node_modules', 'ios', 'android', 'dist', 'build', 'coverage']);

/** Every source file under a directory, hidden directories and `NOT_SOURCE` left out. */
function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!NOT_SOURCE.has(entry.name)) yield* sourceFiles(file);
    } else if (IS_SOURCE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      yield file;
    }
  }
}

/**
 * Each source read so far, by path, with the time it was modified. A worker lives as long as the
 * dev server, and every resource module asks about every source, so a file is read again only
 * once it has changed.
 */
const SOURCES = new Map();

function sourceOf(file) {
  const { mtimeMs } = statSync(file);
  const known = SOURCES.get(file);
  if (known?.mtimeMs === mtimeMs) return known.src;
  const src = readFileSync(file, 'utf8');
  SOURCES.set(file, { mtimeMs, src });
  return src;
}

/**
 * An external template or stylesheet's own module, which in dev carries the hot update for every
 * component that uses it.
 *
 * Metro re-transforms only the file that changed. The component's module stays cached with the
 * old template compiled into it, so bubbling the update up to it re-runs the same code, which can
 * only ask for a reload - and the reload serves that same cached module again, so the edit never
 * arrived at all. This module is the one Metro did re-transform, so it recompiles each owning
 * component against the new text and patches the live class through the same swap an inline
 * template takes.
 *
 * It runs before the component's module does, because the component imports it. On first load
 * that means there is nothing registered to patch yet, so it leaves its defs for the component to
 * pick up as it registers - which is also what makes a reload after the edit show the edit.
 */
function resourceBlock(src, resource, options) {
  const warn = buildWarnings();
  const applies = [];
  const defs = [];

  for (const owner of ownersOf(resource)) {
    const read = (url) => {
      const at = path.resolve(path.dirname(owner.file), url);
      return at === path.resolve(resource) ? src : readFileSync(at, 'utf8');
    };

    for (const component of owner.components) {
      const template = component.template ?? read(component.templateUrl);
      // This module is the only transform an edit to the template reaches, so a template the
      // compiler would cut short without a word has to be caught here as well.
      if (component.template == null) {
        const at = path.resolve(path.dirname(owner.file), component.templateUrl);
        if (at === path.resolve(resource)) {
          assertTemplateFileParses(template, resource, component.className);
        }
      }
      const resources = {
        styles: Object.fromEntries((component.styleUrls ?? []).map((url) => [url, [read(url)]])),
      };
      const parts = componentParts(component, resources, owner.file, owner.src);
      const css = parts.map((part) => part.text).join('\n');
      const sheet = componentSheet(
        css,
        owner.file,
        component.className,
        options?.platform,
        parts,
        warn,
      );

      const update = hotUpdate(template, component, owner.file, options);
      if (!update) {
        // Loud, unlike a component's own block: this is the only transform the edit reaches, so
        // skipping here would be an edit that ships and does nothing.
        throw new Error(`${resource}: ${component.className}'s template did not compile.`);
      }

      applies.push(update.apply);
      defs.push(
        // `source` is the component's file as this update was compiled against, so the component
        // can tell a pending update newer than itself from one older: see `hmrBlock`.
        `{ file: ${JSON.stringify(owner.file)}, id: ${JSON.stringify(update.id)}, ` +
          `source: ${JSON.stringify(hash(owner.src))}, ` +
          `template: ${JSON.stringify(hash(template))}, styles: ${JSON.stringify(hash(css))}, ` +
          `sheet: ${sheet ? literal(sheet) : 'null'}, apply: ${update.name} }`,
      );
    }
  }

  if (!defs.length) {
    // A stylesheet can be global, but a template with nobody beside it is the ceiling above.
    if (resource.endsWith('.html')) {
      console.warn(
        `[angular-native] ${resource}: no component in the project uses it, so an edit to it ` +
          'cannot hot-swap. Save the component that does to pick the edit up.',
      );
    }
    return '';
  }

  return `import * as i0 from "@angular/core";
if (typeof ngDevMode === "undefined" || ngDevMode) {
${applies.join('\n')}
(function () {
  var registry = (globalThis.__angularNativeHmr ||= new Map());
  var pending = (globalThis.__angularNativeHmrPending ||= new Map());
  var resource = ${JSON.stringify(resource)};
  var defs = [${defs.join(', ')}];
${SWAP}
  var reload = false;
  for (var i = 0; i < defs.length; i++) {
    var entry = registry.get(defs[i].file);
    if (!entry) pending.set(defs[i].id, defs[i]);
    else if (!swap(entry, defs[i])) reload = true;
  }

  // As in a component's own block: accept only what was applied.
  if (reload) (globalThis.__angularNativeReload || function () {})(resource);
  else if (typeof module !== "undefined" && module.hot) module.hot.accept();
})();
}
`;
}

/**
 * Compile each component's `styles:` into a rule set and hang it off the class.
 *
 * Angular normally hands `styles` to a SHARED_STYLES_HOST that only platform-browser provides,
 * so on native they are dropped in silence. Compiling here means the CSS costs nothing at
 * runtime, and anything native cannot express is dropped with a build warning that names the
 * file, the line and the reason, instead of doing nothing without a word.
 */
function styleBlock(src, filename, components, resources, platform, warn) {
  const blocks = [];

  for (const component of components ?? []) {
    const parts = componentParts(component, resources, filename, src);
    const css = parts.map((part) => part.text).join('\n');
    const sheet = componentSheet(css, filename, component.className, platform, parts, warn);
    if (sheet) blocks.push(`${component.className}["ɵnativeStyles"] = ${literal(sheet)};`);
  }

  return blocks.length ? `\n${blocks.join('\n')}\n` : '';
}

/**
 * A component's stylesheets, inline and external, each with the file it is in and the line of that
 * file it starts on. An inline sheet's line is where its text is found in the source; a sheet
 * written with an escape in it is not found, and has no line.
 */
function componentParts(component, resources, filename, src) {
  const inline = (component.styles ?? []).map((text) => {
    const at = src ? src.indexOf(text) : -1;
    return { text, file: filename, line: at === -1 ? null : src.slice(0, at).split('\n').length };
  });
  const external = (component.styleUrls ?? []).map((url) => ({
    text: (resources?.styles?.[url] ?? []).join('\n'),
    file: path.join(path.dirname(filename), url),
    line: 1,
  }));
  // In Angular's order: the styleUrl sheets, then the inline styles, which therefore win a tie.
  return [...external, ...inline].filter((part) => part.text);
}

/**
 * Where a line of a component's joined CSS was written: `file:line (Component)`. The sheets are
 * joined one after another, so a line is found by counting through them.
 */
function locator(parts, className) {
  return (line) => {
    let start = 1;
    for (const part of parts) {
      const length = part.text.split('\n').length;
      if (line < start + length) {
        const offset = line - start;
        if (part.line === null)
          return `${part.file} (${className}, line ${offset + 1} of its styles)`;
        // A literal that escapes its line breaks is one line of the file, however many it holds.
        if (part.exact === false && offset > 0) {
          return `${part.file}:${part.line} (${className}, line ${offset + 1} of its styles)`;
        }
        return `${part.file}:${part.line + offset} (${className})`;
      }
      start += length;
    }
    return `${parts[0]?.file ?? ''} (${className})`;
  };
}

/**
 * A build warning for each message, printed once however many times a transform compiles the same
 * sheet: a dev build compiles a component's sheet for its hot update as well as for the class.
 */
function buildWarnings() {
  const seen = new Set();
  return (message) => {
    if (seen.has(message)) return;
    seen.add(message);
    console.warn(`[angular-native] ${message}`);
  };
}

/**
 * The compiled sheet for a component's CSS, or null when there is nothing in it to apply.
 *
 * Anything native cannot express is dropped and reported to `warn`, and the rest of its rule
 * still applies. `platform` is the one Metro is bundling for, so a declaration only one platform
 * draws is dropped with a warning in the build for the other; with none, as under a test, the
 * sheet has to suit both. CSS that does not parse fails the build, unless `recover` is set, as
 * it is for a library's: then the rule is dropped and reported like the rest.
 */
function componentSheet(css, filename, className, platform, parts, warn, recover = false) {
  if (!css.trim()) return null;

  const context = `${filename} (${className})`;
  const options = {
    platform,
    ...(parts ? { locate: locator(parts, className) } : {}),
    onUnsupported: warn,
    recover,
  };

  const sheet = compileCss(css, context, options);
  return sheet.rules.length || sheet.fonts ? sheet : null;
}

/**
 * A compiled sheet as source, with its font files as `require`s.
 *
 * Everything in a sheet is data except a font's source: that is a *module*, and a bundler that
 * never sees the `require` never puts the file in the bundle - leaving a font that is simply
 * missing on the device, with nothing anywhere to say why. So the compiler leaves a marker and
 * this turns it into the call, which is the only place that knows it is emitting code.
 */
function literal(sheet) {
  return JSON.stringify(sheet).replace(
    /\{"asset":("(?:[^"\\]|\\.)*")\}/g,
    (_, path) => `require(${path})`,
  );
}

/**
 * Pass one reports templateUrl/styleUrls it could not resolve; the compiler never touches the
 * filesystem itself. Pass two supplies the contents.
 */
function compileTwice(src, filename, compilerOptions) {
  let result = transformAngularFileSync(src, filename, compilerOptions);
  const dependencies = result.dependencies ?? [];

  let resources = null;
  if (dependencies.length) {
    resources = readResources(dependencies, filename);
    result = transformAngularFileSync(src, filename, compilerOptions, resources);
  }

  fail(result, src, filename, resources);
  return { result, dependencies, resources };
}

/**
 * Every Angular library on npm ships partial-compiled; without the linker they fail at runtime,
 * not at build time. A library's component CSS is written for a browser, so only a web build,
 * which has one to read it, or a dev build, which keeps it as the app's own, leaves it in.
 *
 * A library the app opted in with `libraryStyles` gets what the app's own components get: each
 * component's CSS compiled into the sheet on `ɵnativeStyles`, with what native cannot express
 * dropped under a warning. Without the opt-in a library's components draw with no styles and no
 * word about it, which is what the option exists to make loud.
 */
function link(src, filename, options) {
  const owner = options.platform === 'web' ? null : packageOf(filename, options.projectRoot);
  const listed = owner !== null && options.libraryStyles?.includes(owner.name);
  const { code } = linkAngularPackageSync(
    listed ? withLibrarySheets(src, filename, owner, options.platform) : src,
    filename,
  );
  const strip = options.dev !== true && options.platform !== 'web';
  return { code: strip ? stripComponentStyles(code, filename) : code, dependencies: [] };
}

/**
 * The npm package a file belongs to, `{ name, file }` with the file's path inside the package, or
 * null when nothing claims it.
 *
 * The last `node_modules/<name>/` on its path, which is also the right one under pnpm
 * (`node_modules/.pnpm/<name>@<version>/node_modules/<name>/`), or else the `name` of the nearest
 * `package.json` above it, which is where a linked workspace package says who it is. Metro names a
 * file relative to the project root, which is not always the directory the build was started in.
 */
function packageOf(filename, root = process.cwd()) {
  const absolute = path.resolve(root, filename).split(path.sep).join('/');
  // The closing slash is looked ahead to, not taken: it opens the next `node_modules` on the path.
  const owners = [...absolute.matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/@.][^/]*)(?=\/)/g)];
  const last = owners[owners.length - 1];
  if (last) return { name: last[1], file: absolute.slice(last.index + last[0].length + 1) };
  const directory = projectRoot(absolute);
  const name = manifestName(directory);
  return name === null ? null : { name, file: path.relative(directory, absolute) };
}

/** The `name` in a directory's `package.json`, read once per directory, or null without one. */
const MANIFEST_NAMES = new Map();

function manifestName(directory) {
  if (MANIFEST_NAMES.has(directory)) return MANIFEST_NAMES.get(directory);
  let name = null;
  try {
    const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (typeof manifest.name === 'string') name = manifest.name;
  } catch {
    // No manifest, or not JSON: a file nothing claims, which no package name matches.
  }
  MANIFEST_NAMES.set(directory, name);
  return name;
}

/**
 * The file with each `ɵɵngDeclareComponent({ type: X, ..., styles: [...] })` handing X the sheet
 * its CSS compiles to, as `styleBlock` does for a component the compiler sees.
 *
 * Read from the file as shipped, before the linker: the linker shims the CSS for emulated
 * encapsulation, `[_nghost-%COMP%]`, and that `%` is no selector lightningcss can tokenize. The
 * sheet is put on the definition the call returns, through its `type`, rather than on X by name:
 * a minifier leaves a class named only inside its own body (`var a = class r { ... type: r }`),
 * where a statement after it could not reach it. The linker links the call where it stands.
 *
 * A library's CSS is the library's, so a rule in it that does not parse is dropped with a warning,
 * as a browser drops it, where the app's own fails the build. What it drops is summed up in one
 * line for the file unless `ANGULAR_NATIVE_LIBRARY_WARNINGS=all` asks for each one: a library
 * written for a browser drops a great deal, and a thousand lines bury the one that matters.
 */
function withLibrarySheets(src, filename, owner, platform) {
  const declarations = componentDeclarations(src, filename, 'ɵɵngDeclareComponent');
  if (declarations === null) {
    console.warn(
      `[angular-native] ${filename}: does not parse as JavaScript, so ${owner.name}'s ` +
        'components in it have no sheets.',
    );
    return src;
  }

  // Compiled in the file's order, so the warnings are; then spliced in from the end, so each
  // declaration's offsets still hold when its turn comes.
  const report = libraryWarnings(owner);
  const compiled = declarations
    .sort((a, b) => a.start - b.start)
    .map((declared) => ({
      declared,
      sheet: declaredSheet(declared, filename, platform, report.warn),
    }))
    .filter(({ sheet }) => sheet);
  report.done(compiled.length);
  let out = src;
  for (const { declared, sheet } of compiled.reverse()) {
    const call = out.slice(declared.start, declared.end);
    out =
      out.slice(0, declared.start) +
      `((d) => ((d.type["ɵnativeStyles"] = ${literal(sheet)}), d))(${call})` +
      out.slice(declared.end);
  }
  return out;
}

/** The sheet one declaration's CSS compiles to, or null, saying why when it cannot be read. */
function declaredSheet(declared, filename, platform, warn) {
  const { type, styles } = declared;
  if (!styles) return null;
  if (!styles.entries) {
    console.warn(
      `[angular-native] ${filename}:${styles.line} (${type ?? 'a component'}): its styles are ` +
        'not a list of strings, which is how the Angular compiler writes them, so it has no sheet.',
    );
    return null;
  }
  const parts = styles.entries
    .filter((entry) => entry.value)
    .map((entry) => ({ text: entry.value, file: filename, line: entry.line, exact: entry.exact }));
  if (!parts.length) return null;
  const css = parts.map((part) => part.text).join('\n');
  return componentSheet(css, filename, type ?? 'a component', platform, parts, warn, true);
}

/**
 * Where a library's warnings go: each one, with `ANGULAR_NATIVE_LIBRARY_WARNINGS=all`, or else one
 * line for the file when it is done, counting what was dropped and why.
 */
function libraryWarnings(owner) {
  const every = process.env['ANGULAR_NATIVE_LIBRARY_WARNINGS'] === 'all';
  const seen = new Set();
  return {
    warn(message) {
      if (seen.has(message)) return;
      seen.add(message);
      if (every) console.warn(`[angular-native] ${message}`);
    },
    done(sheets) {
      if (every || !seen.size) return;
      const reasons = new Map();
      for (const message of seen) {
        const reason = reasonOf(message);
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
      const counted = [...reasons].sort((a, b) => b[1] - a[1]);
      const named = counted.slice(0, SUMMARISED).map(([reason, count]) => `${reason} ${count}`);
      const rest = counted.length > SUMMARISED ? `, and ${counted.length - SUMMARISED} more` : '';
      console.warn(
        `[angular-native] ${owner.name} (${owner.file}): ${sheets} sheet${sheets === 1 ? '' : 's'}, ` +
          `${seen.size} declaration${seen.size === 1 ? '' : 's'} and rules dropped: ` +
          `${named.join(', ')}${rest}. Set ANGULAR_NATIVE_LIBRARY_WARNINGS=all to see each one.`,
      );
    },
  };
}

/** How many reasons a summary names before it counts the rest. */
const SUMMARISED = 8;

/** What a warning dropped, in a word or two: the property, the selector part, or the kind. */
function reasonOf(message) {
  // A media query's refusal names the sheet again after the place: `dropped a rule: file (X): ...`.
  const what = message
    .slice(message.indexOf('): ') + 3)
    .replace(/^(dropped a (?:rule|selector): )\S.*? \([^)]*\): /, '$1');
  if (what.startsWith('dropped a rule that does not parse')) return 'CSS that does not parse';
  if (/^dropped a (?:rule|selector): pseudo-elements/.test(what)) return 'a pseudo-element';
  const feature = /^dropped a rule: '([^']+)' is not a media feature/.exec(what);
  if (feature) return `@media (${feature[1]})`;
  const named = /^dropped (?:a (?:rule|selector): )?('[^']+')/.exec(what);
  return named ? named[1] : what.split(':')[0];
}

/**
 * @returns {{ code: string, dependencies: string[], map?: string, mapLineOffset?: number }}
 */
function transformAngular(src, filename, options = {}) {
  // A template or stylesheet is only in the graph to carry its component's edits: empty in a
  // release build, and the hot update for its owners in a native dev build. A web build - a DOM
  // component's page - has no native hot update to carry, and its stylesheets are a browser's.
  if (isResource(filename)) {
    const hot = options.dev && options.platform !== 'web';
    return { code: hot ? resourceBlock(src, filename, options) : '', dependencies: [] };
  }

  if (IS_SOURCE.test(filename) && HAS_ANGULAR_DECORATOR.test(src)) {
    // `ɵsetClassMetadata` re-emits the decorator's arguments, which means a second copy of every
    // component's CSS, unshimmed, on top of the one in the definition. It exists for TestBed's
    // recompilation APIs, which need a JIT compiler this project does not ship, so in a release
    // build it is pure weight. The call is `ngDevMode`-guarded, but the strings are not.
    // `sourcemap` so a stack trace can be pointed back at the file someone wrote: the compiler
    // moves everything - the decorator block goes, an import arrives, a template becomes
    // instructions - and without a map every line number a device reports is wrong.
    const { platform, ...rest } = options;
    const compilerOptions = {
      emitClassMetadata: options.dev === true,
      sourcemap: true,
      ...rest,
    };

    const { result, dependencies, resources } = compileTwice(src, filename, compilerOptions);
    assertNoBrokenMethodShorthand(result.code, filename);
    assertNoShadowedArrowParameters(result.code, filename);
    // Not guarded: a failure here used to fall back to "no components", which compiled the file
    // with no stylesheet and no HMR block and said nothing. A dropped sheet is the one failure
    // this pipeline exists to make loud.
    const components = extractComponentMetadataSync(src, filename);
    assertTemplatesParse(src, filename, components, resources);
    assertTemplatesCompiled(result.code, src, filename, components);
    assertStylesRead(src, filename, components);

    // An external template is not an import, so without an edge Metro would never watch it. The
    // edge does not re-transform this file when the template changes - Metro caches a transform
    // on the file's own content - so the template's module carries the update instead, and is
    // empty in a release build. See `resourceBlock`.
    const edges = dependencies
      .map((dependency) => `import ${JSON.stringify(relativeSpecifier(dependency))};\n`)
      .join('');

    // A DOM component in a web view: the browser applies its `styles` as Angular compiled them, so
    // they stay, and none of native's work applies - its sheet would reject what only a browser
    // has, and its hot update reaches for the native renderer.
    if (platform === 'web') {
      return {
        code: edges + result.code,
        dependencies,
        map: result.map,
        mapLineOffset: dependencies.length,
      };
    }
    const warn = buildWarnings();
    const styles = styleBlock(src, filename, components, resources, platform, warn);
    const hmr = options.dev ? hmrBlock(src, filename, components, resources, options, warn) : '';
    const quiet = hmr ? collisionQuiet(filename, components) : '';
    // Dev keeps the emitted CSS: the bundle size does not matter there, and the HMR path is
    // easier to reason about when the compiler's output is untouched.
    const compiled =
      options.dev === true ? result.code : stripComponentStyles(result.code, filename);
    return {
      code: edges + quiet + compiled + styles + hmr,
      dependencies,
      map: result.map,
      // The resource imports are prepended, so everything the map describes has moved down by
      // however many of them there are. Nothing after the compiler's output shifts a line of it.
      mapLineOffset: (edges + quiet).split('\n').length - 1,
    };
  }

  if (IS_PARTIAL_COMPILED.test(src)) return link(src, filename, options);

  return { code: src, dependencies: [] };
}

module.exports = {
  transformAngular,
  isResource,
  // Exported for `apps/documentation/vite.config.ts`'s own small Vite plugin, which runs the same
  // two checks against `@oxc-angular/vite`'s Vite output - the docs site compiles its own Angular
  // straight out of `@ng-native/components`' source rather than through this Metro pipeline, and
  // is exposed to the same two compiler bugs. Shared rather than copied, so a third confirmed bug
  // in the compiler is one fix rather than two.
  assertNoBrokenMethodShorthand,
  assertNoShadowedArrowParameters,
};
