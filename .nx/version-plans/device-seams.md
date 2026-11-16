---
__default__: patch
---

`@ng-native/device` has the menu model and two seams that later desktop features build on. `defaultMenuBar(appName)` is the App, Edit, View, Window and Help menus a desktop app gets, and `mergeMenuBar(defaults, app)` merges an app's menus into it: an item with a `menuRole` replaces that role's default, `Settings...` shows only when the app gives it a handler, a group with a `menuRole` adds to that standard menu, a `file` group goes after the App menu and any other group after View. `MENU_MODEL` and `createMenuModel()` are where a menu's items register. `WINDOW_NAVIGATOR` is null until a router provides one, and `SIDEBAR_SELECTION` is provided by a sidebar item. Nothing draws these yet.
