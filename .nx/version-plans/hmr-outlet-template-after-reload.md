---
'__default__': patch
---

`@ng-native/metro` applies an edit to a component's external template (its `templateUrl` file) after a reload when the template hosts an outlet, such as `<native-stack-outlet>` or `<native-tabs-outlet>`. An edit to such a template asks for a reload rather than a hot swap, and the reload, served the component's module from Metro's cache, kept showing the template as it was until the component's own `.ts` file changed.
