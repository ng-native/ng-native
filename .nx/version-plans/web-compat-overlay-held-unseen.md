---
__default__: patch
---

With `@ng-native/web-compat`, an overlay a library puts in `document.body`, such as an Angular Material menu, is first seen in the frame after it is inserted, styled and placed, where it was drawn for a frame as it was inserted, and a sheet that opens at the foot of the screen is placed where it was the first time when it opens again.
