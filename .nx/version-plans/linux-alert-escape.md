---
__default__: patch
---

On Linux with libadwaita 1.5 or later, Escape does nothing on an alert that has no cancel button, as on macOS. Before, Escape closed it with no answer, so no button's `onPress` ran and a `Dialogs.tell` or `confirm` promise never settled.
