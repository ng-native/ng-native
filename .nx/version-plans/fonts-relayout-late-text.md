---
__default__: patch
---

Text laid out before its `@font-face` registers switches to that face when `loadFonts()` or `Fonts.load()` registers it, instead of keeping the system font until its content changes.

React Native caches a paragraph's text layout by what the paragraph asks for, so a paragraph committed again unchanged kept the fallback face it was first laid out in. Each paragraph that names a newly registered family is now committed with its `maxFontSizeMultiplier` moved by a step no text size reaches, so native lays it out again in the same view. It keeps its tag and native state. An app that sets its own `maxFontSizeMultiplier` sees it rise by 0.006 for each such face, which makes no visible difference. Text inputs are not laid out again.
