---
title: Where desktop APIs come from
summary: The package each macOS API is imported from, in one table.
---

# Where desktop APIs come from

| API                                                                             | Import from                          |
| ------------------------------------------------------------------------------- | ------------------------------------ |
| `AppWindows`, `CURRENT_WINDOW`, `provideMainWindow`, `provideRestorableWindows` | `@ng-native/device`                  |
| `AppLifecycle`, `provideAppLifecycle`                                           | `@ng-native/device`                  |
| `Menus`, `Dock`, `Tray`                                                         | `@ng-native/device`                  |
| `Processes`, `Shell`                                                            | `@ng-native/device`                  |
| `OS`, `OS_VERSION`, `DESKTOP`, `APPLE`                                          | `@ng-native/device`                  |
| `Dialogs`, `DeepLinks`, `Screen`, `SafeArea`                                    | `@ng-native/device`                  |
| `MenuBar`, `MenuGroup`, `MenuItem`, `MenuSeparator`, `ContextMenu`              | `@ng-native/components`              |
| `Shortcut`, `TrayIcon`, `NativeButton`                                          | `@ng-native/components`              |
| `FileDrop`, `DragItem`                                                          | `@ng-native/components`              |
| `SplitView`, `Sidebar`, `SidebarSection`, `SidebarItem`                         | `@ng-native/components`              |
| `NavigationHistory`, `SidebarItemPath`                                          | `@ng-native/router`                  |
| `DocumentPicker`                                                                | `@ng-native/expo/document-picker`    |
| `Printing`                                                                      | `@ng-native/expo/printing`           |
| `Clipboard`                                                                     | `@ng-native/expo/clipboard`          |
| `Haptics`                                                                       | `@ng-native/expo/haptics`            |
| `KeepAwake`                                                                     | `@ng-native/expo/keep-awake`         |
| `SecureStorage`                                                                 | `@ng-native/expo/secure-store`       |
| `fakeWindows`, `fakeMenus`, `fakeDock`, `fakeTray`, `fakeProcesses`             | `@ng-native/testing`                 |
| `provideDesktopFakes`, `fakeDeepLinks`                                          | `@ng-native/testing`                 |
| The `ng-native-desktop` command and the config plugin                           | `@ng-native/desktop`, never imported |

An element is used by its selector once its class is in the component's `imports`: `MenuBar` is
`<menu-bar>`, `ContextMenu` is `[contextMenu]`, `Shortcut` is `[shortcut]`, `FileDrop` is `(fileDrop)`, `DragItem` is `[dragItem]`, `SplitView` is
`<split-view>`, and `SidebarItemPath` is `<sidebar-item path="...">`.
