---
title: Monitoring
summary: Report crashes, slow screens and sessions to Coralogix, named after your routes.
---

# Monitoring

See how your app behaves on real devices: the crashes, slow screens and failed requests your users
hit, and the session around each one. Angular Native renders through React Native's core, so apps
report to Coralogix's Real User Monitoring through its React Native SDK, on iOS and Android:
[coralogix.com/platform/rum](https://coralogix.com/platform/rum/?utm_source=ng-native&utm_medium=referral&utm_campaign=ng-native).

- **Crashes and errors**, native and JavaScript, with the steps that led to them.
- **Mobile vitals**: cold and warm starts, slow and frozen frames, memory and CPU.
- **Network requests**, linked to your backend's traces through a `traceparent` header.
- **Session Replay**, with every piece of text masked by default.

## Install the SDK

```sh
npx expo install @coralogix/react-native-plugin
npx expo run:ios
```

The SDK includes native code, so it runs in a
[development build](/guide/deployment#install-expo-dev-client-for-a-development-build), not in Expo
Go. Rebuild once after installing it; after that, the dev loop works as before.

## Start it before the app

Call `init` at the top of `src/main.ts`, before the app mounts, so errors during startup are
reported too. It returns a promise that resolves once the SDK has started.

```ts
import { CoralogixDomain, CoralogixRum } from '@coralogix/react-native-plugin';

const options = {
  application: 'my-app',
  environment: __DEV__ ? 'development' : 'production',
  public_key: process.env.EXPO_PUBLIC_CORALOGIX_RUM_KEY!,
  coralogixDomain: CoralogixDomain.EU2,
  version: '1.0.0',
  traceParentInHeader: { enabled: true },
};

CoralogixRum.init(options).catch(console.error);
```

`public_key` is your RUM integration's public key, set as `EXPO_PUBLIC_CORALOGIX_RUM_KEY` in the
app's `.env`, and `coralogixDomain` the region your Coralogix account is in. The key is safe to ship
in the app, as it can only send data.

The app mounts without waiting for `init`, so a request it sends before the SDK has started carries
no `traceparent` header. To trace those too, mount in the runnable once the promise settles, at the
cost of a later first frame. The `catch` mounts the app even if `init` rejects:

```ts
const started = CoralogixRum.init(options).catch(console.error);

AppRegistry.registerRunnable('main', ({ rootTag }) => {
  started.then(() => {
    // The runnable's body from before, starting with mount(Number(rootTag), App, ...)
  });
});
```

On iOS the SDK reports every request the app makes. On Android it reports `fetch` calls, but not
`HttpClient` from `provideNativeHttpClient()`, which sends over `XMLHttpRequest`, unless the app
applies the SDK's optional Gradle plugin; its
[README](https://www.npmjs.com/package/@coralogix/react-native-plugin) covers adding it.

## Name screens after routes

Coralogix groups errors and vitals by view. Set the view whenever Angular's Router finishes a
navigation, so each screen is reported under its route's path, such as `/orders/:id`. The path
leaves out the URL's parameters and query string, which can hold IDs or tokens:

```ts
import { inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { CoralogixRum } from '@coralogix/react-native-plugin';

export class App {
  constructor() {
    const router = inject(Router);
    router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        let route = router.routerState.snapshot.root;
        while (route.firstChild) route = route.firstChild;
        const path = route.pathFromRoot.map((r) => r.routeConfig?.path).filter(Boolean);
        CoralogixRum.setViewContext({ view: '/' + path.join('/') });
      }
    });
  }
}
```

## Report Angular's errors

Angular catches errors thrown in templates, event handlers and lifecycle hooks before they become
crashes. Provide an `ErrorHandler` that passes them on:

```ts
import { ErrorHandler } from '@angular/core';
import { CoralogixRum } from '@coralogix/react-native-plugin';

export class CoralogixErrorHandler implements ErrorHandler {
  handleError(error: unknown) {
    CoralogixRum.reportError(error instanceof Error ? error : new Error(String(error)), false);
    console.error(error);
  }
}

// In the app's providers
{ provide: ErrorHandler, useClass: CoralogixErrorHandler }
```

## Identify users

After sign-in, attach the user to the session so you can find their sessions and errors:

```ts
CoralogixRum.setUserContext({
  user_id: user.id,
  user_name: user.name,
  user_email: user.email,
});
```

## Session Replay

Session Replay records what the user saw before an error, and you choose what share of sessions
to record. Start it once `CoralogixRum.init` has finished, by chaining it to the `init` call in
`src/main.ts` in place of the one above:

```ts
import { CoralogixRum, SessionReplay } from '@coralogix/react-native-plugin';

CoralogixRum.init(options)
  .then(() =>
    SessionReplay.init({
      captureScale: 0.5,
      captureCompressQuality: 0.8,
      sessionRecordingSampleRate: 10,
      autoStartSessionRecording: true,
      maskAllTexts: true,
      maskAllImages: true,
    }),
  )
  .catch(console.error);
```

Text is masked by default and images are not, so the sample masks both. Keep both on until replays
from a staging build show nothing sensitive, then relax them.

## Where to go next

The SDK's reference covers sampling, ignoring errors and URLs, custom spans and timing
measurements:
[@coralogix/react-native-plugin](https://www.npmjs.com/package/@coralogix/react-native-plugin).
[Deployment](/guide/deployment) covers the release builds you will be monitoring.
