---
__default__: patch
---

On Linux with libadwaita 1.5 or later, a click on an alert's button answers with that button when animations are off, as with reduced motion. Before, libadwaita closed the alert before it emitted the response, so the alert answered its cancel button for a click on any other.
