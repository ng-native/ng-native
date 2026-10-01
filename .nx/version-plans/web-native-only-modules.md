---
__default__: patch
---

A browser app on `@ng-native/web` now starts under both `vite` and `vite build` in a workspace that has React Native installed, and `ngNativeWeb()` combines with a tool that sets its own `build.rolldownOptions.external`, such as Storybook.

`ngNativeWeb()` now resolves `react-native` and `expo` to an empty module, in the build and in Vite's dependency pre-bundling, and no longer sets `optimizeDeps.exclude` or `build.rolldownOptions.external`. A static import of a name from `react-native` in browser code now fails the build rather than the page. The `@ng-native/device` services reach React Native only where Fabric is present, so a bundler's own `require` no longer makes them call it in a browser.
