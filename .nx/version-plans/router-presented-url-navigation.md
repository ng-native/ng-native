---
__default__: patch
---

A url that names a page of another tab in the root's `presented` outlet, such as `/home(presented:library/7)`, now shows that page when it arrives before `present()` ever showed it: as a launch link, as a link while the app runs, or through `router.navigateByUrl()` or `router.navigate()`. Before, the router failed with `NG04002: Cannot match any routes`.

The page is given its route in the `presented` outlet only when no route there takes the url. That navigation is then cancelled with a redirect and starts again, once, to the same url with the same state. A url that names no page of the app, or a page `present()` shows in its own tab instead, such as one behind a `canMatch` guard, still fails with `NG04002`. With no presentation of its own, as from a link, the page is presented as a modal. `router.config` now holds one more route in the `presented` outlet, after the pages' routes there, with the path `**` and a `canMatch` guard. It is added again as the next navigation starts after `resetConfig()`.
