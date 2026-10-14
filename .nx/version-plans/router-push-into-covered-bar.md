---
'__default__': minor
---

A push to a page of the tab bar from a screen over the bar, pushed on the app's own stack or presented, goes back to the bar: to that tab where it was left, with the page pushed onto it. It built a second tab bar over the screen, which took the first bar's pages, so a tab in it could show a page no longer told it was in front, and going back could leave a blank tab. A page of the tab in front presented over such a screen goes to the presented outlet, as a page of another tab does. A second tab bar is no longer built this way; an app that wants a screen over the bar opens a route outside it.
