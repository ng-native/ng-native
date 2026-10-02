---
title: Android permissions
summary: A common shape for Android's runtime permissions, granted outright on iOS.
---

# Android permissions

`androidPermission(name)` returns a pair of functions for one Android permission: one to ask what
the answer is now, and one to request it. Both resolve to `{ status, granted, canAskAgain }`, with
`status` one of `granted`, `denied` or `undetermined`.

```ts
import { androidPermission } from '@ng-native/device';

const [check, request] = androidPermission('android.permission.CAMERA');

if (!(await check()).granted && !(await request()).granted) {
  // The user said no. Show them what the feature would have done, not an error.
}
```

`check()` cannot tell "denied" from "not yet asked" - `PermissionsAndroid.check` only answers yes
or no - so a permission nobody has asked about yet answers `undetermined` rather than `denied`,
which is the honest answer and lets a caller decide whether to ask. `request()` maps Android's
`never_ask_again` result onto `canAskAgain: false`, which is Android's way of saying the dialog is
over; anything else is a no the user can still change their mind about, so `canAskAgain` stays
`true`.

`PermissionsAndroid` predates the pattern every Expo module settled on - it returns a string where
they return a record, and has no notion of "the platform will not ask again" beyond a third status.
This adapts it, so a camera permission from `expo-camera` and a `POST_NOTIFICATIONS` from Android
read the same way at the call site. Expo's own modules ask for their own permissions, so reach for
this only for a permission no module you already use covers.

## Off a device and on iOS

On iOS every one of these resolves `granted`, without asking anyone, because the permissions Android
asks about at runtime are ones iOS either grants at install or does not have - a caller should not
have to branch on the platform to find that out. Off a device the answer is the same: `granted`.

`androidPermission` is a function rather than a service, so it has no class of its own to reference
here; `PermissionAnswer` above is its whole return shape.
