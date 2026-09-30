---
__default__: patch
---

A tab tap whose navigation fails or is refused now puts the tab bar straight back on the tab the app is on, and a deep link whose page fails to load reaches the app's `ErrorHandler` rather than ending as an unhandled promise rejection.

The tab bar's revert was sent to native only with the next render, which a failed navigation does not cause, so the bar stayed on the tab that failed. The app's `withNavigationErrorHandler` hears each failure once, as before. The Router page has a new "When a page fails to load" section on handling a lazy route that fails, however the navigation started.
