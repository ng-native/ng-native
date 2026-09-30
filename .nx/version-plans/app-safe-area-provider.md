---
__default__: patch
---

The app that the starter template, `nx g @ng-native/nx:app` and `ng add @ng-native/schematics` generate now wraps its `<safe-area-view>` in a `<safe-area-provider>`, so its content is inset from the first frame on iOS instead of jumping into place after the first relayout.

Without a provider above it, a `<safe-area-view>` reads its own insets once, before it has been laid out, and gets zero. An app generated earlier can make the same change in `src/app/app.ts`: add `SafeAreaProvider` to `imports` and put `<safe-area-provider>` around the template.
