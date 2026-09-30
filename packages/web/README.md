# @ng-native/web

A browser host for Angular Native: the same `@ng-native/components` templates, rendered into the
DOM instead of native views. It implements the `HostEngine` seam the Fabric engine implements, so
a `<view>`, a `<pressable>` or a `<text-input>` behaves the same way in a browser as it does on a
phone - which is what the documentation site's live examples and this project's browser tests run
on.

Alpha: APIs may change before 1.0.

## Install

```sh
npm install @angular/core rxjs @ng-native/components @ng-native/web
npm install --save-dev vite typescript
```

A browser app builds with Vite. `ngNativeWeb()` compiles the app's components, links the
`@ng-native/*` packages, and keeps React Native and Expo out of the bundle:

```ts
// vite.config.ts
import { ngNativeWeb } from '@ng-native/web/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [ngNativeWeb()],
});
```

The Angular CLI's builders cannot compile the packages; an Angular app that hosts islands builds
with Vite and `ngNativeWeb()` instead.

## Example

Mounting a component into a page:

```ts
import { mount } from '@ng-native/web';
import { App } from './app';

mount(document.querySelector('app-root')!, App);
```

`mount` injects a reset stylesheet that gives elements React Native's layout defaults (border-box,
no flex shrinking, a full-height column root) unless `injectReset: false` is passed, and takes
`providers` the way `bootstrapApplication` does.

Inside an Angular web app you already have, place a component in any template with
`<ng-native-island>`. It shares the app's services and change detection:

```ts
import { NgNativeIsland } from '@ng-native/web';

@Component({
  imports: [NgNativeIsland],
  template: `<ng-native-island
    [component]="wallet"
    [inputs]="{ accountId }"
    [outputs]="{ paid: onPaid }"
  />`,
})
export class AccountPage {}
```

Or from code, `mount(element, Wallet, { injector })` with an injector from the app, and
`destroy()` on the result to take the island down again.

## Docs

- [Web](https://ng-native.com/packages/web):
  setting up a browser app, with Tailwind
- [Native and web](https://ng-native.com/guide/native-and-web)
- [Islands](https://ng-native.com/packages/web/islands):
  Angular Native components inside an existing Angular web app
- [Root README](https://github.com/ng-native/ng-native/blob/main/README.md) and
  [ARCHITECTURE.md](https://github.com/ng-native/ng-native/blob/main/docs/ARCHITECTURE.md)

## License

MIT
