---
__default__: patch
---

A box whose `box-sizing` alone changes is now laid out again on iOS and Android, where it kept the size it had: React Native's Yoga does not compare `boxSizing` when a view's props change. To do that, a `content-box` box whose sizes, padding and border are all in points is committed as the border box it makes, with `boxSizing: 'border-box'` and its padding and border added to its `width`, `height` and their least and most. It lays out the same, but the props a test reads from a commit change for such a box, a web-compat `div` and text field among them.

A `content-box` box with a percentage size or padding is committed as it was, and still keeps its size on iOS and Android when its `box-sizing` alone changes.
