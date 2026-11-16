---
__default__: patch
---

Interaction observers now hear a `<switch>` the user flips and a `<native-button>` pressed where the platform draws it (iOS and macOS), each as a `click` with no value.

A switch's event carries its label, IDs and role but not whether it is now on, and its `source` is `click`, as it has no touch point; so is a native button's on iOS and macOS. A native button on Android was already reported through the responder. Observers run after the control's own outputs, and a disabled native button reports nothing.
