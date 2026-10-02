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

`withAngularNative(config, options)` does five things to the config Expo hands you:

- Sets `config.transformer.babelTransformerPath` to its own transformer, which compiles Angular
  before Expo's own stock transformer runs.
- Adds `html`, `css` and `scss` to `config.resolver.sourceExts`, so an external template or
  stylesheet becomes an edge in Metro's module graph and Metro watches it. In a release build the
  transformer emits those as empty modules; in dev each one carries the hot update for the
  components that use it (see [hot reload](#hot-reload-without-an-angular-dev-server) below).
  It also takes `html` back out of `config.resolver.assetExts`, where Expo lists it for its DOM
  components: Metro checks assets first, and a template bundled as an asset never reaches the
  transformer.
- Wraps Expo's transform worker (`config.transformerPath`) so that, in dev and on native, a
  stylesheet reaches the transformer above. Expo's worker otherwise turns every native stylesheet
  into an empty module before any transformer sees it, which would leave an edited `styleUrl`
  nothing to carry its update in. Web stylesheets, CSS modules and release builds are left to Expo.
  A transform worker you configured yourself is left alone, and an edited stylesheet then reloads.
- Adds three polyfills to `config.serializer.getPolyfills`, which run before `@angular/core` is
  first evaluated: one clears `ngDevMode` in a production build (Angular's CLI does this at build
  time normally and Metro does not, so without this a release bundle runs every dev-mode assertion
  Angular has; the preset also folds it in Terser so the dead branches are stripped), and one
  defines the globals `animate.enter` and `animate.leave` read to decide whether they do anything at
  all - `document.documentElement.getAnimations`, `Node.ELEMENT_NODE`, and stand-ins for
  `AnimationEvent`/`TransitionEvent` that make every animation this environment reports read as a
  transition (see [Animation](/packages/fabric/animation)), and one defines `FinalizationRegistry`,
  which Hermes lacks and Angular's signal debug graph constructs while `@angular/core` is first
  evaluated.
- Bumps `config.transformer.cacheVersion` with a hash of the compiler's own `.cjs` sources, found by
  walking the package directory rather than a hand-kept list. In a dev server, it also watches those
  same sources and logs a warning if they change, because Metro loads the transformer into a worker
  pool once at startup: an edit to the compiler otherwise reaches nothing until you restart, with no
  error at all.

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

- A capitalized element name is a hard build failure, not a blank screen: this checks for exactly
  that shape per component and throws, naming the element it found, rather than letting a green
  build ship an empty screen.
- A resource import is added for every external template or stylesheet a component uses, so
  Metro's module graph has an edge to it and watches it.
- Source positions are remapped so a stack trace, warning or debugger points at the file you wrote
  rather than the compiled output.
- `emitClassMetadata` is only on in dev - it re-emits a component's decorator arguments verbatim,
  which exists for `TestBed`'s JIT recompilation and is pure bundle weight in a release build that
  ships no JIT compiler at all.

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
[What `styles` can be](/packages/fabric/css-engine) lists the forms that compile.

### A library's component CSS

A component library from npm arrives partial-compiled and goes through Angular's linker, not the
compiler above, and its CSS stays as it was written: for a browser. By default nothing compiles it,
so a library's components draw with no styles and no warning. Name the packages whose CSS you want
compiled, and each of their components gets a sheet the way yours do:

```js
module.exports = withAngularNative(getDefaultConfig(__dirname), {
  libraryStyles: ['@acme/ui'],
});
```

The CSS is read from the file as the library shipped it, before the linker shims it for emulated
encapsulation, so a `:host([data-tone="warm"])` rule compiles to the host attribute match it means.
What native cannot express is dropped under the same warnings as your own CSS, naming the library's
file, the line and the component; a library written for a browser can produce a long list, and
each line is a declaration that does nothing on a device. The rules a library writes for a browser
and native reads differently - `display: flex` with the row direction a browser gives it, `:hover`,
`position: fixed` - are the same ones [what CSS reaches a device](/packages/fabric/supported-css)
lists for your own CSS.

A package is named as it is imported, `@acme/ui`, and matched by the `node_modules/@acme/ui/` on a
file's path, or by the `name` in the nearest `package.json` for a linked workspace library. A
dependency of the library, under its own `node_modules`, is not the library. The list goes into
Metro's `cacheVersion`, so changing it starts the cache afresh. The option needs the preset's
transform worker in front of Expo's, which is how the list reaches the transformer; with a
`transformerPath` of your own the preset refuses it rather than let it do nothing. A web build
leaves the library's CSS to the browser, as it does yours, and an edit to a library's CSS reloads
rather than hot-swaps.

## Hot reload without an Angular dev server

Angular's own HMR fetches a "replace metadata" module over HTTP from a Vite dev server, which Metro
and Hermes have no equivalent of. So the compiler generates that module and embeds it directly in
the file it belongs to: on re-evaluation, the embedded block patches the original class - the one
live views still point at - by calling `ɵɵreplaceMetadata`, and then calls `module.hot.accept()` so
Metro stops bubbling the change into a full reload.

Only a template or inline `styles` edit can be applied this way. The block decides by hashing the
file with every component's template and inline styles removed - if that "shape" hash has not moved,
only those changed and the swap runs, carrying the recompiled rule set for a styles edit; if it has
(a new method, a different import, a changed selector), it falls back to a full reload through
`globalThis.__angularNativeReload`, the hook [`mount()` installs in
development](/packages/platform/bootstrapping). That hook exists because React Native's own Fast
Refresh accepts an update and reports success even when the actual reload needed a fresh module
evaluation, so without it an edit that is more than a template would ship, log nothing, and leave
the app running the code from before the edit while looking like it worked.

A template can change shape freely: the swap rebuilds the component's views with the new
template's own slot and binding counts, so adding or removing elements, bindings, `@if` or `@for`
blocks keeps the component's state. If a swap throws partway through anyway - an expression that
fails on its first render, say - the block logs the error and falls back to a full reload, rather
than leaving a half-rebuilt view on screen that throws on every change detection after it.

### External templates and stylesheets

An edit to a `templateUrl` or `styleUrl` file swaps in place too, keeping the component's state. It
cannot go through the component's own module: Metro caches a transform on the file's own content and
re-transforms only the file that changed, so the component's module is still the one compiled
against the old template. Instead the template's or stylesheet's own module does it. In dev, the
transformer finds the components that use the file - the source files anywhere in the project (the
nearest directory above the file with a `package.json`, leaving out `node_modules`, `ios`, `android`
and build output) naming it in a `templateUrl` or `styleUrl`, whether as `./card.css` beside it or
`../shared/lab.css` from another directory - and compiles each of them against the new text into
that module: the same `ɵɵreplaceMetadata` swap, plus the component's recompiled rule set when the
file is a stylesheet. The module accepts its own update, so nothing bubbles into a reload.

The same module also fixes what a full reload after the edit shows. It runs before the component's
module (the component imports it), and when the component registers, any template or sheet newer
than the one it was compiled with is applied first.

A stylesheet several screens share is swapped on every one of them by the one edit. The ceiling is
the project: a component in another package of a monorepo that reaches the file across the package
boundary is not found, and the dev server warns when a template has no component in the project
using it. An edit to the component's `.ts` file follows the rules above: a changed selector, input,
method or import is a full reload, whichever file its template lives in. Inline `styles` edits can
hot-swap too, the same as a template edit - it is a change to selectors, inputs, methods or imports
that forces a full reload, not which kind of style the edit touched.
