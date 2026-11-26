---
__default__: patch
---

`toMatchScreenshot()` and `screenshot()` from `@ng-native/testing/device` now wait for the platform to mount the view of a node the test just rendered, within their `timeout`, instead of failing at once with `No view with tag <n>`.

On Android, the views of a commit mount on the UI thread, which can be after the frame `render` waits for, so a screenshot taken straight after `render` sometimes found no view. A node whose view never mounts still fails at the `timeout`, with the platform's error. Any other capture error still fails at once.
