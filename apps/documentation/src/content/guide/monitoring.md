---
title: Monitoring
summary: Report crashes, slow screens and sessions from your app to Coralogix, named after your routes.
---

# Monitoring

See how your app behaves on real devices: the crashes, slow screens and failed requests your users
hit, and the session around each one. Angular Native renders through React Native's core, so apps
report to [Coralogix](https://coralogix.com/?utm_source=ng-native&utm_medium=referral&utm_campaign=ng-native)
through its React Native SDK, on iOS and Android.

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
reported too. It is asynchronous, and events wait until it finishes.

```ts
import { CoralogixRum } from '@coralogix/react-native-plugin';

CoralogixRum.init({
  application: 'my-app',
  environment: __DEV__ ? 'development' : 'production',
  public_key: process.env.EXPO_PUBLIC_CORALOGIX_RUM_KEY,
  coralogixDomain: 'EU2',
  version: '1.0.0',
  traceParentInHeader: { enabled: true },
});
```

`public_key` is your RUM integration's public key, and `coralogixDomain` the region your Coralogix
account is in. The key is safe to ship in the app, as it can only send data.

## Name screens after routes

Coralogix groups errors and vitals by view. Set the view whenever Angular's Router finishes a
navigation, so each screen is reported under its route:

```ts
import { inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { CoralogixRum } from '@coralogix/react-native-plugin';

export class App {
  constructor() {
    inject(Router).events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        CoralogixRum.setViewContext({ view: event.urlAfterRedirects });
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

Session Replay records what the user saw before an error. Every piece of text is masked unless you
turn that off, and you choose what share of sessions to record:

```ts
import { SessionReplay } from '@coralogix/react-native-plugin';

SessionReplay.init({
  captureScale: 0.5,
  captureCompressQuality: 0.8,
  sessionRecordingSampleRate: 10,
  autoStartSessionRecording: true,
  maskAllTexts: true,
});
```

## Where to go next

The [Coralogix React Native SDK reference](https://www.npmjs.com/package/@coralogix/react-native-plugin)
covers sampling, ignoring errors and URLs, custom spans and timing measurements.
[Deployment](/guide/deployment) covers the release builds you will be monitoring.
