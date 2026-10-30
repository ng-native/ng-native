---
__default__: patch
---

`@ng-native/expo` has `AddressSearch`, from `@ng-native/expo/address-search`: `suggest(query, options)` answers a signal of the postal addresses that match a query signal, and `resolve(suggestion)` answers the picked one's line one, town, postcode, country and other parts, with no permission and no API key.

On iOS it uses MapKit's `MKLocalSearchCompleter` and `MKLocalSearch`. On Android it uses the platform's `Geocoder` once the query has not changed for 300 ms, and that geocoder answers whole addresses rather than completions. `region: 'GB'` keeps the suggestions to that country on Android, to the area around it on iOS 18 and later, and puts that area first on earlier iOS versions. It is native code of `@ng-native/expo`, so an app needs a new development build to use it. In Expo Go the suggestions stay empty.
