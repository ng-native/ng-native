---
__default__: patch
---

Each window `AppWindows` opens has a `Screen` and a `SafeArea` of its own, sized by that window, and its media queries resolve against the window's size and scale. A change of colour scheme, text size or reduced motion that `watchConditions` gives the app reaches every window, with the `dark` class, where windows kept the conditions they opened with and only took their own resizes.
