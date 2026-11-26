---
__default__: patch
---

`ng-native-desktop run` shows the app by its `expo.name`, and by its icon unless that is an Icon Composer `.icon` folder, on macOS, as a packaged app does, rather than as `ngn-macos` with a generic icon, and says how long a first build from source takes when the folder it builds in has none yet and no earlier line has already said so.

On macOS `run` starts the host from a thin `<expo.name>.app` in `.expo/ng-native-desktop/dev`, a copy of the host whose Info.plist names the app, gives its bundle identifier and carries the usage strings a packaged app has, so the menu bar, About, Hide and Quit, the Dock and the app switcher name the app, and the Dock and the app switcher show its icon (`ios.icon`, else `icon`; an Icon Composer `.icon` folder shows only once packaged). The icon reaches the host as `NGN_DESKTOP_ICON`, which a host from an earlier release ignores.

Being a bundled app changes three things in a dev run on macOS: a permission is asked for in the app's name and needs its usage string, as in a packaged app; notifications are available, subject to the user granting authorization, where a bare host had them off; and preferences are kept in the bundle identifier's own defaults, so those set by earlier dev runs, kept under the app id in the host's shared defaults, are not read.

On Linux the app and its main window take the app's name (a window opened with a title of its own keeps it), and the windows take its `icon` where the app sets one (`ios.icon` alone gives none), offered to GTK as the windows' default icon; GNOME on Wayland still shows the app id and a generic icon until the app is installed from a package, and a dev run of an app whose package of the same app id is installed can show that package's name and icon.

The first-build note was judged by the React Native version's whole cache, which every app shares, so a new install, or another app with libraries of its own, built for minutes with no note. The build now prints it for the folder it builds in, before Hermes or the host compiles.

A host crash under `vitest --project macos` still names its crash report: the macOS launcher looks for reports named for `ngn-macos` and for the app a dev run made in `.expo/ng-native-desktop/dev` of its `cwd`, and its `executable` option takes several names.
