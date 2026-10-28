---
title: Firebase Messaging
summary: The app's Firebase Installation ID, registered with FCM, for a backend to send push to.
---

# Firebase Messaging

`@ng-native/firebase-messaging` registers the app's Firebase Installation ID (FID) with Firebase
Cloud Messaging, so a backend can send a push to it with the `fid` target of FCM's HTTP v1 API. FCM
rejects a send to an FID with `UNREGISTERED` until the installation is registered.

Push notifications are shown and tapped through `Notifications` in
[`@ng-native/expo`](/packages/expo/notifications), as with any other push. This package only adds
the registration.

## Install

```sh
npx expo install @ng-native/firebase-messaging expo-notifications
```

Add the plugin and Firebase's config files to `app.json`, then rebuild the app. It needs a
development build, not Expo Go.

```json
{
  "expo": {
    "plugins": ["@ng-native/firebase-messaging"],
    "ios": { "googleServicesFile": "./GoogleService-Info.plist" },
    "android": { "googleServicesFile": "./google-services.json" }
  }
}
```

Expo copies each file into the app at prebuild, and prebuild fails when one is missing. When the
files are not in the repository (each developer supplies their own, or EAS provides them as file
environment variables), set each path in `app.config.js` only when its file is there:

```js
const { existsSync } = require('node:fs');

const file = (variable, path) => process.env[variable] ?? (existsSync(path) ? path : undefined);

module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    googleServicesFile: file('GOOGLE_SERVICE_INFO_PLIST', './GoogleService-Info.plist'),
  },
  android: {
    ...config.android,
    googleServicesFile: file('GOOGLE_SERVICES_JSON', './google-services.json'),
  },
});
```

A build without the file runs, and `register()` rejects with the code `ERR_NO_FIREBASE_CONFIG` on
iOS and Android.

The plugin turns on FCM registration by installation ID, which both platforms leave off. On iOS it
also turns off Firebase's app delegate proxy, which would take over the push methods
`expo-notifications` already handles, and gives the `GoogleUtilities` pod modules in the Podfile,
which Firebase's Swift pods need to link as static libraries.

## Register

```ts
import { Service, effect, inject } from '@angular/core';
import { FirebaseMessaging } from '@ng-native/firebase-messaging';

@Service()
export class Push {
  private readonly messaging = inject(FirebaseMessaging);
  private readonly api = inject(Api);

  constructor() {
    effect(() => {
      const fid = this.messaging.installationId();
      if (fid) void this.api.savePushTarget(fid);
    });
  }

  enable(): Promise<string | null> {
    return this.messaging.register();
  }
}
```

- `register()` asks for the notification permission when it has not been answered, registers the
  installation with FCM and answers its FID. On iOS FCM delivers over APNs, so it registers with the
  APNs token `Notifications` reports. It answers null without the permission.
- `installationId` is the FID each registration answers. Once it has registered, when the platform
  rolls the push token while the app runs, the installation is registered again with the new token
  and this is set again, so an effect on it keeps the backend up to date. Firebase can also replace
  the FID by itself, so once registered, the FID is read again each time the app comes back to the
  front, and this follows it.
- `getInstallationId()` answers the FID without registering it.

Without the native module, in Expo Go, on the web host or in a test that provides nothing, every
call answers null. A test provides a fake through `FirebaseMessaging.SOURCE`. Until `register()`
runs, the service reads nothing from `Notifications`, so a test's fake of `Notifications` needs only
the members the test uses.

## Unregister

When the app's pushes belong to the signed-in user, call `unregister()` on sign-out. Otherwise the
backend still holds the FID against the old user, and their pushes keep arriving after someone else
signs in on the same device.

```ts
async signOut(): Promise<void> {
  await this.messaging.unregister();
  await this.auth.signOut();
}
```

`unregister()` deletes the installation, so FCM answers `UNREGISTERED` for its FID, and sets
`installationId` to null. A roll of the push token or a return to the front registers and reads
nothing until `register()` runs again, which registers a new FID for the effect to send to the
backend.

## Send from a backend

A backend sends to the FID with FCM's HTTP v1 `messages.send`, authorized with an OAuth 2.0 token
for a service account of the Firebase project:

```bash
curl -X POST "https://fcm.googleapis.com/v1/projects/$PROJECT_ID/messages:send" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "message": { "fid": "'"$FID"'", "notification": { "title": "Hello", "body": "From FCM" } } }'
```

A response of `404` with `UNREGISTERED` means the installation is not registered: the app has not
called `register()` yet, it called `unregister()`, or it was uninstalled, and the backend can drop
that FID.
