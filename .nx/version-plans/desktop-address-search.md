---
__default__: patch
---

On macOS `AddressSearch` suggests addresses and resolves the picked one through the desktop host's `NgNativeAddressSearch`, over MapKit's `MKLocalSearchCompleter` and `MKLocalSearch`, as on iOS. It suggested nothing there before.
