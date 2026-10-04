---
__default__: patch
---

A percentage height under a parent with no height of its own is no height, as CSS reads it: the box is as tall as what it holds. It was a percentage of the space on offer, the height of the screen or of everything a scroll view holds, so a `height: 100%` box inside a content-sized one filled the screen. A parent has a height when it is written, when the parent grows in a column that has one, when it is stretched across a row, or when it is placed absolutely; under any of those the percentage is kept. To keep a box the height of the screen, give its parent a height or `flex: 1`.
