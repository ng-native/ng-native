---
__default__: patch
---

`@ng-native/web-compat` now draws a background of one image in a library's stylesheet, `background: url('/wallpaper.jpg') center / cover`, as the platform's image under what the box holds, which was dropped with a warning before.

It fills the box as `cover`, `contain` or `100% 100%` says, or repeats the image, and its address is resolved against the page's as an `<img>`'s is. A size in points is drawn at the image's own size, with a warning in development. An app's own stylesheet still refuses a `url()` background, which nothing draws there.

Android's image view is given the background image as a list of sources, which it reads, where one source crashed the app.
