---
title: The page's address and frames
summary: What document.URL and window.location say, the url option, and an iframe on a device.
---

# The page's address and frames

## The page's address

The page is at the app's own URL, with the route the app is on: `document.URL`,
`document.baseURI` and `window.location` say it. A relative link, an image's `src` and the other
URLs an element's attributes say resolve against it, as a browser resolves them against the
address of the page it shows. A `<base href>` in the head changes what they resolve against.

The app's URL is the one Expo opens the app with: `exp://127.0.0.1:8081/--/` in Expo Go, and the
app config's `scheme` in a build, so with a `scheme` of `shop` the settings route is a page at
`shop:///settings`. An app with neither is at `app://`. The `url` option gives it an address that
wins over both:

```ts
import { provideWebCompat } from '@ng-native/web-compat';

export const webCompat = provideWebCompat({ url: 'https://shop.example/' });
```

`location.assign()`, `replace()` and setting `href` or a part of it go to a page of the app the way
a link to it does, through the router, and open any other URL with `Linking`. `reload()` does
nothing.

## Frames

An `<iframe>` is a native web view from `react-native-webview`, which shows the page in it as a
browser does, its scripts included. An app with a frame installs it:

```sh
npx expo install react-native-webview
```

`src` resolves against the page's address, and `srcdoc` is shown with the page's address as its
base where that is a web address. A frame is 300 by 150 points, as in a browser, unless its
`width`, `height` or a stylesheet say otherwise, and hears `load` as its page finishes loading.

The app has the frame as a browser has a frame of another origin: `contentDocument` is `null`, and
the two talk with `postMessage`. `iframe.contentWindow.postMessage(data, origin)` is a `message`
event in the page, from the app's origin, whose `source` the page answers through. The page's
`window.parent.postMessage(data, origin)`, and `window.ReactNativeWebView.postMessage`, are a
`message` event on the app's `window`, whose `source` is the frame's `contentWindow`. Messages
cross as JSON. `window.frames` lists the frames.

The page is sent as the frame's `Referer`, as `referrerpolicy` says, where its address is a web
address. A video embed that asks who embeds it needs `provideWebCompat({ url })` to give one in
Expo Go, whose `exp://` address is not a web address. `sandbox` without `allow-scripts` runs no
script, and `allow` turns on autoplay, fullscreen and picture in picture where it lists them.
`loading` and the rest of `sandbox` are left out, and development says so.

### Emulated frames

Where `react-native-webview` is not installed, and in Node, a frame is an emulated document
instead: a document of the app's own, from `about:blank`, `srcdoc` or what `src` names, which a
script reads and writes as a document of its own origin, with its own `location`, `defaultView`,
listeners, and `open`, `write` and `close`. It is not drawn, so a measurement in it is zero, and
no script in it runs. An app that measures or prints in a frame asks for it, and so does a test
that reads a frame's document:

```ts
import { provideWebCompat } from '@ng-native/web-compat';

export const webCompat = provideWebCompat({ frames: 'emulated' });
```

`loadFrame` reads what an emulated frame's `src` names, and is `fetch` for an `http` or `https`
URL where it is not given. It answers the markup, with its type and the URL it ended up at, or
`undefined` for a URL it cannot read:

```ts
import { provideWebCompat, type FrameLoader } from '@ng-native/web-compat';

const loadFrame: FrameLoader = (url) =>
  url.endsWith('/help') ? { body: '<p>Help</p>', contentType: 'text/html', url } : undefined;

export const webCompat = provideWebCompat({ frames: 'emulated', loadFrame });
```
