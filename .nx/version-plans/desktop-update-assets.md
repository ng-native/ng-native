---
__default__: patch
---

On macOS the desktop host downloads an Expo update's other assets with its bundle, checks each against the manifest's hash, and lays them out where the bundle looks for them, so an image new in the update shows. An asset a kept update already has with the same hash is not downloaded again.
