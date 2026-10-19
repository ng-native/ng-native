# @ng-native/web-compat

Opt-in DOM compatibility for Angular Native. A component library written for the browser reaches
for the DOM on the elements it renders: `getAttribute`, `classList`, `addEventListener`. This
package gives the engine's nodes those members, each going through the engine's own mutation API,
so such a library can render as native views.

Experimental and partial. It has:

- Node names and kinds, attributes and classes, `textContent`, and listeners with
  `dispatchEvent`.
- The tree: live `childNodes` and `children`, the nodes around one, `appendChild`,
  `insertBefore`, `removeChild`, `replaceChild`, `append`, `prepend`, `replaceChildren`,
  `before`, `after`, `replaceWith`, `insertAdjacentElement`, `moveBefore`, `cloneNode`,
  `getRootNode`, `compareDocumentPosition`, `isEqualNode` and `normalize`, each checked as a
  browser checks an insertion. Texts and comments have `data` and the rest of `CharacterData`.
- Live `getElementsByTagName`, `getElementsByClassName` and `getElementsByName`.
- `MutationObserver`, with `childList`, `attributes`, `characterData`, `subtree` and old values.
- A `document` that creates engine nodes and fragments, with a `body` that draws over the screen
  for overlays, a doctype, `createTreeWalker` and `createNodeIterator`.
- The basic `window` globals: its listeners, `Event`, `CustomEvent`, `HTMLElement`, `Node`,
  `Text`, `Comment`, `DocumentFragment`, `NodeList`, `HTMLCollection` and the window's size.
- A `click` listener that hears a press.

Markup (`innerHTML`), selectors, `element.style`, computed style, geometry, the other observers,
forms and the rest of the DOM are not part of it yet.

Nothing in an app changes until it adds the provider, and everything the provider adds is taken
away again when the app is destroyed.

## Install

```sh
npm install @ng-native/web-compat
```

## Use

```ts
import { provideWebCompat } from '@ng-native/web-compat';

export const appConfig = {
  providers: [provideWebCompat()],
};
```

## Name what is written for a browser

A library's stylesheets are read as a browser reads them only for the packages the build is
given: a flex container is a row. Wrap the Metro config last:

```js
const { withWebCompat } = require('@ng-native/web-compat/metro');

module.exports = withWebCompat(config, {
  libraries: ['@angular/cdk', '@angular/material'],
  // Components a library's CLI copies into the app, as Spartan UI's styled layer is.
  sources: ['./src/app/ui'],
});
```

`libraries` are npm packages. `sources` are directories of the app's own sources, relative to the
project. Every other component in the app stays the native view it is.

## A library that asks whether it is in a browser

Angular's `PLATFORM_ID` is `native` on a device, and some libraries open an overlay or measure
only where it is `browser`. Give the component or the route of such a library's page a browser's
id. The rest of the app keeps reading `native`.

```ts
import { provideBrowserPlatformId } from '@ng-native/web-compat';

@Component({
  providers: [provideBrowserPlatformId()],
})
export class SettingsPage {}
```
