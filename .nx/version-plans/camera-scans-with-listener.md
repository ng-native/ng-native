---
__default__: patch
---

`<expo-camera>` now scans for barcodes while `(barcodeScanned)` has a listener, as `expo-camera`'s `CameraView` does when it is given `onBarcodeScanned`.

Before, binding `(barcodeScanned)` alone scanned nothing until `barcodeScannerEnabled` was set too. `[barcodeScannerEnabled]` still wins, so `false` stops scanning with the listener in place. With neither, the camera commits `barcodeScannerEnabled: false`, as `CameraView` does. `outputListened` in `@ng-native/device` is the signal it follows: whether an output has a listener.
