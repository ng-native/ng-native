---
__default__: patch
---

On Linux with libadwaita 1.5 or later, a click on an alert's button answers with that button when animations are off.

Animations are off with reduced motion, for one. Before, libadwaita closed the alert before it emitted the response, so the alert answered its cancel button for a click on any other.
