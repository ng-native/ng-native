---
__default__: patch
---

A warning about a Tailwind rule native cannot express now names the rule's selector, such as `[angular-native] .grid (Tailwind): dropped 'display': ...`, rather than a line of the generated `app.tailwind.css`.

The generated sheet's lines move as classes are added, and the selector is what to search the app for. CSS escapes are undone, so `md:grid` and `2xl:grid` read as written in a template, and a rule with several selectors names each of them.
