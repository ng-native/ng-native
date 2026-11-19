---
__default__: patch
---

`Browser.signIn()` works on Linux: the GTK host opens the page in the default browser through the OpenURI portal, shows a dialog with a Cancel button while the sign-in runs, and resolves to the link back to the app on the redirect URL's scheme, which the desktop hands to an installed app. The app's `DeepLinks` never hear that link. Cancel resolves `signIn()` to null.
