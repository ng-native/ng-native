# @ng-native/router

`@angular/router` - the same `Router`, route config, guards, resolvers and deep links - pointed at
`react-native-screens` instead of the DOM: a real native stack, tabs and header, not something
drawn to look like one.

Alpha: APIs may change before 1.0.

## Install

Most apps start from `npx create-expo-app@latest my-app --template @ng-native/template` and add
routing on top. Otherwise:

```sh
npm install @ng-native/router
npm install @angular/common @angular/core @angular/router
```

## Example

```ts
import { AppRegistry } from 'react-native';
import { withComponentInputBinding } from '@angular/router';
import { mount } from '@ng-native/platform';
import { getFabricUIManager } from '@ng-native/fabric';
import { provideNativeRouter } from '@ng-native/router';
import { routes } from './routes.ts';
import { App } from './app.ts';

AppRegistry.registerRunnable('main', ({ rootTag }) => {
  mount(Number(rootTag), App, getFabricUIManager(), {
    providers: [provideNativeRouter(routes, withComponentInputBinding())],
  });
});
```

`withComponentInputBinding()` is what turns a route param into a component input. It is opt-in,
as on the web: leave it out and the outlets leave a page's inputs alone.

```ts
@Component({
  selector: 'app-root',
  imports: [NativeStackOutlet, SafeAreaProvider],
  template: `
    <safe-area-provider>
      <native-stack-outlet />
    </safe-area-provider>
  `,
  host: { '[style]': 'fill' },
})
export class App {
  protected readonly fill = { flex: 1 };
}
```

## What's in the package

- `provideNativeRouter(routes, ...features)` - Angular's `provideRouter`, with a native
  `PlatformLocation`, a `RouteReuseStrategy` that detaches rather than destroys a popped screen,
  and `NativeNavigation` on top. Its native features are `withLinkParent`, `withHeaderDefaults` and
  `withTabDefaults`.
- `NativeStackOutlet`, `NativeTabsOutlet`, `NativeTab` - the outlets, as elements.
- `NativeHeader`, `NativeHeaderItem`, `NATIVE_HEADER_PALETTE`, `NativeSearchBar` - the native
  header and its slots.
- `nativeRouterLink` - the native equivalent of `routerLink`.
- `NativeNavigation` - replacing a screen, presenting a modal or sheet, resetting the stack: what a
  URL alone cannot express.
- `fileRoutes(pages)` - routes made from the files in `src/app/pages`, with Analog's file names
  (`index.page.ts`, `[id].page.ts`, `[...slug].page.ts`, `(group)` folders, layouts and `.md`
  pages), found by Metro's `require.context`:

  ```ts
  const pages = require.context('./pages', true, /\.page\.ts$/, 'lazy');

  provideNativeRouter(fileRoutes(pages), withComponentInputBinding());
  ```

## Docs

- [Router](https://ng-native.com/packages/router)
- [File routes](https://ng-native.com/packages/router/file-routes)
- [Root README](https://github.com/ng-native/ng-native/blob/main/README.md) and
  [ARCHITECTURE.md](https://github.com/ng-native/ng-native/blob/main/docs/ARCHITECTURE.md)

## License

MIT
