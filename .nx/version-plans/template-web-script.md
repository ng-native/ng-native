---
__default__: patch
---

`npm run web` in an app created from `@ng-native/template` now explains that the app targets iOS and Android and links to the web guide, instead of failing with npm's `Missing script: "web"`. `create-expo-app` suggests the command as it finishes, whatever the template defines.
