---
__default__: patch
---

On Linux with libadwaita 1.5 or later, Escape does nothing on an alert shown over a window that has no cancel button, as on macOS, and the alert's own buttons still close it.

Before, Escape closed it with no answer, so no button's `onPress` ran and a `Dialogs.tell` or `confirm` promise never settled. An alert shown while no window is open is a libadwaita message dialog, which Escape still closes.
