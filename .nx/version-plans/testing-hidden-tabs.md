---
__default__: minor
---

Queries leave out what a tab behind the selected one in a `<native-tabs-outlet>` holds, as the tab bar shows only the selected tab, so a test that found content on a tab behind no longer finds it.

To migrate, select the tab first, or pass `{ includeHiddenElements: true }` to a query that means to reach a tab behind.

The `<native-tab>` itself, its item in the bar, is still found. A query `within` a view on a tab behind finds nothing either.
