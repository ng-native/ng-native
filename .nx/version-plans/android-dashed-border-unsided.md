---
'__default__': patch
---

On Android a dashed or dotted border with rounded corners stays dashed while its `border-color` or `border-width` transitions, and when an element's own style gives every side the same new width or colour, where it was drawn solid.

Android strokes a rounded border dashed only from the unsided `borderWidth` and `borderColor`, and only while all four sides equal them. These are now worked out from the props the view is committed with, after the element's style and each frame of a transition, so they follow the sides; before, they came from the stylesheet alone.
