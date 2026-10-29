---
__default__: patch
---

In `@ng-native/expo`, `Location.geocode()` and `Location.reverseGeocode()` no longer ask for the location permission on iOS, so an app that only geocodes shows no location prompt there.

Apple's geocoder needs no permission, and `expo-location` asks for none before geocoding on iOS. Before, both methods asked for the foreground permission first on every platform and answered an empty list when it was refused. On Android they still ask first and answer an empty list without it, because `expo-location` refuses to geocode there without the foreground permission.
