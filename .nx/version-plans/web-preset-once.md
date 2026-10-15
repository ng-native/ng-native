---
'__default__': patch
---

`ngNativeWeb()` registered twice, as the Storybook recipe does in the app's `vite.config.ts` and again in `viteFinal`, applies once. With `@oxc-angular/vite` 0.0.41 the second copy compiled each component again and failed the build with "Unsupported call to the input function".
