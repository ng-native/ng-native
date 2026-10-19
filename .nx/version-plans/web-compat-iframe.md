---
__default__: patch
---

With `@ng-native/web-compat`, the page has an address: the app's own URL with the route it is on, in `document.URL`, `documentURI`, `baseURI` and a new `window.location`, and a `<base href>` in the head changes what it resolves against. A relative link, an image's `src`, a form's `action` and the other URLs an element's attributes say now resolve against it, where they read as written, an `<a>` and an `<area>` have the parts of their URL (`protocol`, `host`, `pathname`, `search`, `hash` and the rest), and `:target` matches the element the address's fragment names. The address is the one Expo opens the app with, `exp://` in Expo Go or the app config's `scheme` in a build, or the one `provideWebCompat({ url })` is given. `location.assign()` to a page of the app goes there through the router, and opens any other URL with `Linking`. Angular's `Location` has a platform to stand on in an app with no router.

An `<iframe>` is a native web view from `react-native-webview`, an optional peer dependency, which runs and draws the page in it as a browser does. `src` and `srcdoc` say what it shows, it is 300 by 150 points unless its `width`, `height` or a stylesheet say otherwise, and `load` fires as its page finishes loading. `contentDocument` is `null`, as for a frame of another origin, and the app and the page talk with `postMessage` both ways. Where `react-native-webview` is not installed, and in Node, the frame is an emulated document of the app's own, which a script reads and writes, and `provideWebCompat({ frames: 'emulated' })` asks for that document in any app. `window.frames` and `window.postMessage` are there.

`DeepLinks` from `@ng-native/device` has `follow(path)`, which hands a path of the app's own to its listeners as a link that arrived from outside is handed, so the router navigates to it.

The Metro preset has Expo build a lazy route's chunk URL from the dev server on iOS and Android, where it built one from a global `location` wherever there is one, which with the page's address is an `exp://` URL React Native cannot fetch.
