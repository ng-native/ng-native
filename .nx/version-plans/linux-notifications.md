---
__default__: patch
---

On the GTK desktop host on Linux, `Notifications` shows local notifications through the Notification portal, or GLib's notifications where no portal answers, fires scheduled ones from a timer kept in the app's data folder while the app runs, shows one that came due while the app was closed on its next launch, and hears a click as the response.
