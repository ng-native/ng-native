---
__default__: patch
---

In an Expo app, an edit that hot reload cannot apply now reloads the app through Expo's reload rather than React Native's `DevSettings.reload()`, which in Expo Go brought the app back with "Cannot find native module 'ExpoFontLoader'" until Expo Go was relaunched.

Metro reloads the app itself for an edit nothing accepts, such as a route file, a service or a change to a component that is more than its template, and it does so through React Native's Fast Refresh runtime. In a development build, `mount()` now points that runtime's full reload at `reloadAppAsync()` from `expo`, which works in Expo Go and development builds alike. An app without `expo` keeps React Native's reload, and a release build is unchanged.
