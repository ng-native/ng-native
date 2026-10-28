# @ng-native/firebase-messaging

The app's Firebase Installation ID (FID), registered with Firebase Cloud Messaging, for a backend
that sends push notifications through FCM's HTTP v1 API with the `fid` target.

Alpha: APIs may change before 1.0.

## Install

```sh
npx expo install @ng-native/firebase-messaging expo-notifications
```

Add `"@ng-native/firebase-messaging"` to the plugins in `app.json`, with Expo's
`ios.googleServicesFile` and `android.googleServicesFile`, then rebuild the app: it needs a
development build, not Expo Go.

## Example

```ts
import { Service, effect, inject } from '@angular/core';
import { FirebaseMessaging } from '@ng-native/firebase-messaging';

@Service()
export class Push {
  private readonly messaging = inject(FirebaseMessaging);

  constructor() {
    effect(() => {
      const fid = this.messaging.installationId();
      if (fid) void sendToBackend(fid);
    });
  }

  enable(): Promise<string | null> {
    return this.messaging.register();
  }
}
```

The documentation is at
[ng-native.com/packages/firebase-messaging](https://ng-native.com/packages/firebase-messaging).
