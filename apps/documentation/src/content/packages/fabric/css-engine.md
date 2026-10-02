---
title: The CSS engine
summary: How component stylesheets get compiled, matched and cascaded with no DOM involved.
---

# The CSS engine

Angular's `styles` and `styleUrl` are real CSS here, not silently dropped the way they are without
`platform-browser`. The work splits across two very different halves, and understanding the split
explains most of what is and is not possible.

## Build time: compiling to a rule set

Inside the Metro transform, each component's stylesheet is parsed with lightningcss and compiled
into a rule set: selectors reduced to compounds and combinators, values converted to what React
Native's style API takes, specificity computed, and the whole list sorted once. The result is
attached to the component class as `ɵnativeStyles`, which is also what scopes it -
`RendererFactory2.createRenderer(host, type)` is handed the component's own definition, and a
definition references its own class, so a renderer finds its sheet with no registry and no
generated id. Anything native genuinely cannot express is dropped with a build warning naming
the file, the line and the reason, not left to silently do nothing - see [what CSS reaches a
device](/packages/fabric/supported-css) and [Metro](/packages/metro/configuration) for what that
allowlist covers.

### What `styles` can be

The sheet is compiled from the component's source file alone, so `styles` has to be something that
file spells out. Each entry, or `styles` itself, can be:

- a string literal
- a template literal, including one whose substitutions are same-file constants
- a constant declared in the same file that holds one of those
- an array of any of the above

```ts
import { Component } from '@angular/core';

const BOX = '.box { width: 50px; }';
const TITLE = '.title { font-weight: 600; }';

@Component({
  selector: 'app-card',
  styleUrl: '../shared/cards.css', // shared between files: a stylesheet, not an import
  styles: [
    `
      ${BOX}${TITLE}
    `,
    '.x { height: 1px; }',
  ],
  template: '<view class="box"></view>',
})
export class Card {}
```

An imported constant, a concatenation with `+`, a spread, a constant that holds an array, or a
function call cannot be read at build time, and the build fails naming the component and the entry.
CSS shared between components belongs in a `.css` file, listed in `styleUrl` or `styleUrls` by every
component that uses it; a component's own `styles` apply alongside it, after the shared sheets, as
Angular orders them, so an inline rule wins over a shared one of the same specificity. A
concatenation of same-file constants is written as a template literal with one substitution per
constant.

## Runtime: matching and merging

The resolver only ever matches and merges a pre-sorted list; nothing is parsed again. Matching goes
right to left, like every CSS engine: a rule is filed under the most selective type, class or id in
its rightmost compound (its key selector), so a node only ever tries the rules that could possibly
match it, and the leftward compounds are checked only once the key selector already did.

A node is matched against up to three sheets merged together: the application's global stylesheet
(if you passed one to `mount()` as `globalStyles`), the sheet of the component it is the host
element of, and the sheet of the component that created it. A component's own rules count for one
extra class of specificity over the global sheet's - the same bump Angular's own emulated
encapsulation already grants a rule by rewriting it to carry an `[_ngcontent-x]` attribute, kept
here so the precedence people already have in their fingers just works.

A component with `encapsulation: ViewEncapsulation.None` has no sheet of its own. Angular adds such
a component's CSS to a browser's document as written when the component first renders, so here its
sheet becomes a global one at that moment, matched against every node after the application's.
Its rules reach any element, its own host by class among them and the app's own elements, and
`:host` in it matches nothing, as in a browser. It counts no extra class, so it loses to a
component's rule of the same selector and wins a tie with one, having arrived later. It stays
registered once its last instance is gone, as in a browser with Angular's
`REMOVE_STYLES_ON_COMPONENT_DESTROY` off, so a component shown and hidden does not restyle every
node each time. Shadow DOM's sheet stays the component's own, scoped as a shadow root scopes it.
Angular Material writes every component this way.

## Inheritance is emulated, not real

React Native's views do not inherit anything - a `color` set on a view has no effect on a `<text>`
nested inside it, only text-inside-text inherits - which would silently break every stylesheet
written with CSS's actual inheritance in mind. So the cascade emulates it for exactly the properties
where that expectation matters: `color`, `direction`, `fontFamily`, `fontSize`, `fontStyle`,
`fontWeight`, `fontVariant`, `letterSpacing`, `lineHeight`, `textAlign`, `textTransform`,
`textDecorationLine`, `writingDirection`, the text shadow and `selectable` (`user-select`). Nothing
else cascades down past the element it is set on - `padding` on a wrapper never reaches its
children, on this platform or in real CSS either.

A paragraph's `text-align` is resolved against the `direction` it inherits, from a stylesheet or
an inline style above it: with none written it starts at the start edge, `start` and `end` follow
the direction, and `left` and `right` stay on their side. See
[Direction](/packages/device/direction).

## Custom properties and tokens

A custom property (`--primary: ...`) cascades exactly like an inherited value, which is what makes
it the one thing able to reach inside a component it does not otherwise know about: an ordinary
rule cannot, because a component's compiled sheet only ever matches its own elements. `var()`
resolves per node against whatever tokens are in scope, so a design token set from a parent -
`--primary` retheming a child's internals - works, while writing a selector to reach inside a
component's own markup does not.

A `var()` naming a custom property that nothing in scope defines, with no fallback, drops the
declaration, as a browser does. In development the engine warns once per name, since a phone has
no inspector to show the declaration struck out.

## Media queries

`@media` conditions are evaluated against whatever [`mount()`'s `conditions`
option](/packages/platform/bootstrapping) carried in: `width`, `height`, `orientation`,
`prefers-color-scheme` and `prefers-reduced-motion`. Those are the only features a device can
actually answer, so a query using `hover`, `pointer`, the `print` media type or a `not` qualifier
drops its whole `@media` block with a build warning rather than silently never matching. Nothing
re-evaluates a media query on its own - a rotation or a system theme change dirties no component
and no binding - which is why `@ng-native/device`'s `watchConditions(engine)` exists; see
[Bootstrapping](/packages/platform/bootstrapping).
