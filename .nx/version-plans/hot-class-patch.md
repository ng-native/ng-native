---
'__default__': patch
---

Hot reload keeps the app's state and its route for far more edits, where only a template or a style edit did. An edited method, getter or lifecycle hook is patched onto the live component, service or directive, and an edited function onto every module that calls it; a template or a `computed` that called one shows the result at once. An edit that still needs a full reload, to a field, a constructor, a constant or a route file, comes back on the page it left with its back stack, where it returned to the first route. In Expo Go on Android such an edit now reloads the app, where it was dropped and the app went on running the code from before it. A file two lazy routes share no longer reloads the app for an edit that could be applied.
