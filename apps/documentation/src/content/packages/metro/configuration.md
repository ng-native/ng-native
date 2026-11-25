---
title: Configuration
summary: What withAngularNative wires up, and how component CSS and hot reload work.
---

# Configuration

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');

module.exports = withAngularNative(getDefaultConfig(__dirname));
```

`withAngularNative(config, options)` gives the config Expo hands you:

- a transformer that compiles Angular components, templates and component CSS before Expo's own,
- `html`, `css` and `scss` as source files, so Metro watches external templates and stylesheets,
  and `woff`/`woff2` as assets, for a [DOM component](/packages/expo/dom-components)'s fonts,
- the polyfills `@angular/core` needs on Hermes: `ngDevMode` cleared in a release build, the
  globals [`animate.enter` and `animate.leave`](/packages/fabric/animation) read, and
  `FinalizationRegistry`,
- a cache that is redone when the compiler, a `templateUrl` or a `styleUrl` file changes, and a dev
  server that serves the new text of an edited template or stylesheet.

Set your own `cacheStores` and `server.enhanceMiddleware` before calling `withAngularNative`, which
wraps the ones it finds. With a `transformerPath` of your own, an edited stylesheet reloads rather
than hot-swaps, and a release build needs `npx expo export --clear` after a template or stylesheet
edit.

Pass `{ workspaceRoot }` in a monorepo where the framework packages live outside your app's own
`node_modules` - it adds the workspace root to `watchFolders` and both `node_modules` directories to
`resolver.nodeModulesPaths`, which is what lets Metro see a workspace package's source at all.

## What happens to a component file

The transformer only touches `.ts`/`.tsx` files containing `@Component`, `@Directive`, `@Pipe`,
`@Injectable`, `@NgModule` or `@Service` - everything else passes through unchanged, except a
partial-compiled Angular library from npm (anything shipping `ɵɵngDeclareComponent` and friends),
which is run through Angular's own linker so it becomes runnable without a separate `ngcc`-style
step.

A matching file goes through the AOT compiler: templates become instructions, the decorator block
is gone, styles are compiled separately (below). A few things ride along with that:

- A capitalized element name fails the build, naming the element (see
  [Components](/packages/components#one-name-two-layers)).
- A resource import is added for every external template or stylesheet a component uses, so
  Metro's module graph has an edge to it and watches it.
- Source positions are remapped so a stack trace, warning or debugger points at the file you wrote
  rather than the compiled output.
- `emitClassMetadata` is only on in dev - it re-emits a component's decorator arguments verbatim,
  which exists for `TestBed`'s JIT recompilation and is pure bundle weight in a release build that
  ships no JIT compiler at all.

### Angular's hybrid compiler (experimental)

The AOT compiler is oxc's by default. `compilation: 'ngp'` compiles with Angular's own hybrid
compiler instead, ngp: a Rust analysis pass in front of Angular's TypeScript template compiler, the
way [Analog](https://analogjs.org) offers it.

```js
module.exports = withAngularNative(getDefaultConfig(__dirname), { compilation: 'ngp' });
```

- It needs Angular 22.2 or later, with `typescript` and `@angular/compiler-cli` installed.
  `@ng-native/metro` ships a build of `@angular/ngp`; an app with `@angular/ngp` installed uses that
  one. `ANGULAR_NATIVE_NGP_COMPILER` names another build.
- It compiles against the app's `tsconfig.json` (`tsconfig` names another file) and its
  `angularCompilerOptions` and `customConditions`. A component outside that program is compiled by
  oxc.
- Templates and TypeScript are type-checked as they compile, so the build fails on a type error at
  its line in the template. That needs `@typescript/native-preview` (or `TSNATIVE_BINARY_PATH`);
  `disableTypeChecking: true` turns it off.
- It reports an element no component in `imports` matches, as `ngc` does.
- Like `libraryStyles`, it needs the preset in front of Expo's transform worker.

## Component CSS

Each component's `styles`/`styleUrl` is compiled with lightningcss into a rule set and attached to
the class as a static: `MyComponent["ɵnativeStyles"] = {...}`. That is the only thing that reaches
the class - Angular's own `styles: [...]` array on the definition is emptied in a production build,
because nothing on this platform reads it. In dev it is left in place, because the hot-reload path
below is easier to reason about against untouched compiler output and bundle size does not matter
there.

A declaration or rule native cannot express is dropped with a build warning that names the file,
the line and the reason, and the rest of the sheet still compiles - see [what CSS reaches a
device](/packages/fabric/supported-css) for exactly what that allowlist covers. This holds for dev,
hot reload and release bundles alike, and for a declaration only one platform draws, which is
dropped with a warning in the build for the other. CSS that does not parse fails the build.

A `styles` entry the compiler cannot read from the component's own file, such as an imported
constant or a concatenation with `+`, also fails the build, naming the component and the entry.
[What `styles` can be](/packages/fabric/css-engine#what-styles-can-be) lists the forms that compile.

### A library's component CSS

A component library from npm arrives partial-compiled and goes through Angular's linker, not the
compiler above, and its CSS stays as it was written: for a browser. The preset compiles it on the
way through, for every library, so each of a library's components gets a sheet the way yours do,
with nothing to configure.

`libraryStyles` narrows that. A list names the only npm packages whose component CSS is compiled,
and `false` compiles none but the `@ng-native/*` packages', which are always compiled. A library
left out draws with no styles and no warning:

```js
module.exports = withAngularNative(getDefaultConfig(__dirname), {
  libraryStyles: ['@acme/ui'],
});
```

The CSS is read from the file as the library shipped it, before the linker shims it for emulated
encapsulation, so a `:host([data-tone="warm"])` rule compiles to the host attribute match it means.
What native cannot express is dropped, as your own CSS's is, and a rule that does not parse is
dropped too, as a browser drops it, where in your own CSS it fails the build. A library written for
a browser drops a great deal, so each of its files that drops anything gets one line counting what
was dropped and why, and a file that drops nothing gets none:

```text
[angular-native] @acme/ui (fesm2022/acme-ui.mjs): 12 sheets, 40 declarations and rules dropped:
a pseudo-element 14, ':hover' 9, 'cursor' 6, ..., ...
```

Set `ANGULAR_NATIVE_LIBRARY_WARNINGS=all` in the environment Metro starts in to see each one,
naming the library's file, the line and the component, as your own CSS's warnings do. The warnings
are printed when a file is transformed, so a build from a warm cache prints none; start Metro with
`--clear` to see them again. The rules a library writes for a browser
and native reads differently - `display: flex` with the row direction a browser gives it, `:hover`,
`float` - are the same ones [what CSS reaches a device](/packages/fabric/supported-css)
lists for your own CSS. A component the library writes with `ViewEncapsulation.None`, as Angular
Material writes every one, has its sheet matched as a global one once it renders, as a browser
applies it: see [the CSS engine](/packages/fabric/css-engine).

The `@ng-native/*` packages are never listed, and no list leaves them out: their components' CSS,
such as `<markdown>`'s default classes and `<touchable-opacity>`'s fade, is written for the device
and always compiled, from the workspace or from npm.

A package is named as its `package.json` names it, `@acme/ui`, and matched by the
`node_modules/@acme/ui/` on a file's path, or by the `name` in the nearest `package.json` for a
linked workspace library. An entry point such as `@acme/ui/button` is part of its package, so the
preset refuses it and asks for `@acme/ui`, as it refuses a path or a name no npm package can have.
A dependency of the library, under its own `node_modules`, is not the library. The list goes into
Metro's `cacheVersion`, so changing it starts the cache afresh. The option needs the preset's
transform worker in front of Expo's, which is how the list reaches the transformer; with a
`transformerPath` of your own the preset refuses it rather than let it do nothing, and when
something replaces the worker after the preset, the build says that a listed library's file arrived
without the list. A web build
leaves the library's CSS to the browser, as it does yours, and an edit to a library's CSS reloads
rather than hot-swaps.

## Hot reload without an Angular dev server

The compiler embeds Angular's HMR update in each component's own module, so Metro's hot reload
swaps a component in place with no Angular dev server. A template or style edit, inline or in a
`templateUrl` or `styleUrl` file, and an edited method, getter, lifecycle hook or top-level
function keep the running app's state. A template can add or remove elements, bindings, `@if` and
`@for` blocks. An edit a patch cannot apply, or a swap that throws, falls back to a full reload,
which returns to the page it left. A stylesheet shared by several components swaps in every one of
them within the project; a component in another package of a monorepo picks up the edit only when
its own file changes. [Limitations](/guide/limitations#hot-reload-has-a-few-full-reload-cases)
lists which edits reload.
