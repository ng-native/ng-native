---
__default__: patch
---

`deviceTests()` and `devicePool()` take `screenshots.resolveScreenshotPath`, as in Vitest's browser mode, to choose where each `toMatchScreenshot()` reference is kept, such as a name per machine so CI's references and a laptop's stay apart.

It is given the screenshot's `name`, `ext`, `platform` (the OS the app runs on), `host` (`process.platform`, which Vitest names `platform`), the project's `root`, `testFileDirectory`, `testFileName` and `screenshotDirectory`, and returns a path, absolute or from the project's root. The capture and difference of a failure are written beside it. Without it, references stay at `__screenshots__/<test file>/<name>-<platform>.png` beside the test file.
