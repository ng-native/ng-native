---
__default__: patch
---

A canvas stroke drawn under a transform that stretches one way more than another, or skews, is shown as wide along each way as a browser draws it, where it was one width all round.

A text stroked under a transform is as wide as the line, where the transform scaled it twice, and a gradient or pattern a text is painted with runs from where the canvas has it, where it ran from the text's place.

A shape drawn again without the transform it had is drawn with none on iOS, where it kept the old one.
