---
__default__: patch
---

On iOS, `Notifications` puts the data of a push sent through FCM or straight to APNs in `request.content.data`, which `expo-notifications` fills only for a push from Expo's push service.

This covers `latest`, `response`, `take()`, `presented()`, and the notification a `setHandler()` handler is passed, including the one on a timeout error given to its `handleError`. The keys come from `request.trigger.payload` and are used only when `content.data` is null or missing. The keys the push services add are left out: `aps`, FCM's `fcm_options`, `gcm.` and `google.` keys, and on a push from Expo's service its `experienceId`, `projectId` and `scopeKey`. Android, local notifications and an Expo push whose `data` the module already read are unchanged.
