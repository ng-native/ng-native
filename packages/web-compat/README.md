# @ng-native/web-compat

Opt-in DOM compatibility for Angular Native. A component library written for the browser reaches
for the DOM on the elements it renders: `getAttribute`, `classList`, `closest`, `addEventListener`.
This package gives the engine's nodes those members, each going through the engine's own mutation
API, so such a library renders as native views.

It also provides a `document` that creates engine nodes, with a `body` that draws over the screen
for overlays; the `window` globals a library reads, `ResizeObserver` among them; and a `click`
listener that hears a press.

Experimental. Nothing in an app changes until it adds the provider.

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
