---
'__default__': minor
---

An engine node's element tag is now `tag` rather than `name`, on `EngineNode`, `StyleTarget`, `ViewNameNode` and `NamedHostNode` from `@ng-native/fabric` and `BrowserNode` from `@ng-native/web`, so read `node.tag` where you read `node.name`, or let the `engine-node-tag` migration do it (`nx migrate @ng-native/nx@latest`, `ng update @ng-native/schematics` or `npx @ng-native/migrate@latest`, as [Updating an app](https://ng-native.com/guide/updating) describes).

`name` is the DOM's attribute, and a web library that set `input.name = 'email'` on a node renamed the element. The migration rewrites a `.name` only where the code shows it is read from one of those types, and prints a note with the file and line for each `nativeElement.name`, which an `ElementRef` without a type hides from the compiler, for each `name` read from a node cast to another type, such as `node as { name?: string }`, which still compiles after the rename, and for each other `.name` it cannot place in a file that imports one of them.
