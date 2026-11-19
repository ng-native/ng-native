---
__default__: patch
---

`@ng-native/web-compat` has `provideEventPlugins()`, from `@ng-native/web-compat/event-plugins`, which runs Angular's event-manager plugins (`EVENT_MANAGER_PLUGINS`) for an app's listeners. A listener whose name a plugin claims is attached by that plugin, as it is in a browser, so Taiga UI's tabs, which listen for `tui-tab-activate.stop` through `@taiga-ui/event-plugins`, now switch when a tab is pressed. Before, such a listener heard nothing. A plugin that claims every name, as Angular's own DOM plugin does, is left to the renderer. `@angular/platform-browser` is an optional peer dependency of the package, needed only for this entry point.
