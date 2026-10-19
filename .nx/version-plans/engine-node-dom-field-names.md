---
__default__: minor
---

An engine node's fields with names a DOM element also uses are renamed: `children` is now `childList`, `text` is `nodeText`, `kind` is `nodeKind`, `host` is `engine` and `sheet` is `templateSheet`, on `EngineNode`, `HostNode`, `StyleTarget` and `ViewNameNode` from `@ng-native/fabric` and `BrowserNode` from `@ng-native/web`, so read the new name where you read the old one, or let the `engine-node-fields` migration do it (`nx migrate @ng-native/nx@latest`, `ng update @ng-native/schematics` or `npx @ng-native/migrate@latest`, as [Updating an app](https://ng-native.com/guide/updating) describes).

A node read as an element by code written for the web no longer has a field of the engine's hiding the DOM member of the same name. The migration rewrites a read only where the code shows it is read from one of those types, and prints a note with the file and line for each it cannot place in a file that imports one of them, for each read of a `nativeElement`, and for each read from a node cast to another type. A node's `props` keep their names: `props['text']`, a text input's value, is read as it was, and the migration leaves it alone.
