---
__default__: patch
---

With `@ng-native/web-compat`, the document's `getElementsByTagName`, `getElementsByTagNameNS`, `getElementsByClassName`, `getElementsByName` and `getElementById` now find `<html>` and `<head>`, as Chrome does, so `document.getElementsByTagName('head')[0]` is `document.head` and `getElementsByClassName('dark')` finds a theme class on `<html>`.

They answered no `<html>` and no `<head>` before, which made code such as Taiga UI's `provideTaiga()` and Angular's `Meta` throw when it read `getElementsByTagName('head')[0]`. The elements come in the order `querySelectorAll` gives them, so `getElementsByTagName('*')` and `querySelectorAll('*')` hold the same elements in the same order: `<html>`, then the head and what it holds, then the page. A head a script has put in the page comes where it is in the page instead. The lists stay live: a class added to or taken off `<html>` or `<head>` changes what they hold. An element's own `getElementsBy*` still finds only what is under it.
