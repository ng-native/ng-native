# @ng-native/desktop

The macOS desktop host for Angular Native: React Native's C++ core and Hermes, mounting an app's
views into AppKit, and the `ng-native-desktop` command that builds and launches it. You install the
package and never import it.

Alpha, and early: the host draws views, text, text fields, images, scroll views, modals (as a
sheet, an in-window cover, or an NSPopover when the modal has an `anchor`), takes clicks, hover
and the scroll wheel, loads the app from the dev server with reload and Fast Refresh, runs React
Native's layout animations, and has the default menu bar. React Native's iOS modules answer from
the core: Linking, Appearance, AppState, DeviceInfo, PlatformConstants, I18nManager, Alert
(NSAlert), Clipboard, Networking (streaming, progress, cookies, redirects), WebSocket, Blob,
FileReader, ImageLoader and `@react-native-async-storage` (2.x and 3.x, file-backed). It has no
React Native DevTools yet.

A `<modal>` with `pageSheet`, `formSheet` or no presentation style is an NSWindow sheet on its
window, stacked on a sheet already there. It takes its content root's CSS width and height, or
480 points wide and as tall as its content lays out, measured from the shadow tree in a second
commit, and stays between 320x200 and the window. `fullScreen`, `overFullScreen` and `transparent`
are a cover in the window below its title bar and toolbar, and a transparent one shows the window
through. Escape and Cmd-W ask a sheet or a cover to close (`requestClose`), the one in front
first, and Cmd-W stays on Close Window even when the app's own menu bar leaves it out. An alert
with no key window runs app-modally, so its answer always arrives.

The app starts on a surface the host never shows, and every window it opens (`AppWindows`, through
the `NgNativeWindows` module) is an NSWindow with a surface of its own on the one runtime, shown
when its first frame mounts. The close button, Cmd-W, Cmd-Q and a logout ask the app, which closes
the window or answers the quit; the host never closes a window or quits on its own, and closing the
last window leaves the app running. A Dock click with no window open sends `reopen`. A window's
frame autosaves under its key (`main`, a route outlet or a `restoreKey`) in the app's preferences
and comes back there, within its size limits, when a window with that key opens again. A reload
closes the windows with no key and keeps the rest for five seconds for the reloaded app to open
again. An app that renders on its own surface instead gets that surface in a window.

The menu bar is the app's (`<menu-bar>`, through `NgNativeMenus`), drawn as NSApp's main menu
once the app sets it, with the host's Developer menu kept before Help; until then the host's own
default bar shows. An item with a `menuRole` is AppKit's own command (Copy reaches the focused
field) unless the app handles it. An app's `[shortcut]` takes its key press before the menus do,
except that Cmd-Z, X, C, V and A still reach a focused text input. A view's `[contextMenu]` shows
as an NSMenu on a secondary click, and its choice comes back to the view. View > Back and Forward
(Cmd-[ and Cmd-]), mouse buttons 4 and 5, a three-finger swipe and, with "Swipe between pages",
a two-finger sideways swipe that nothing scrolls send `navigate` with the window's surface.

Each `<tray-icon>` is an NSStatusItem (`NgNativeTray`): an SF Symbol as a template image or a named
image, a title and a tooltip, with its menu on a click or a press when it has none. The `Dock`
service's menu sits above the Dock menu's own items, and its bounce is
`requestUserAttention`, cancelled by the function it answers. A reload clears the tray icons and
the Dock menu until the reloaded app sets its own. The Dock badge is the count of
`NgNativeNotifications` (see Notifications).

The mouse reaches an app as on the web: every move goes to React Native's pointer events, which
send `(mouseenter)`, `(mouseleave)`, `(mousemove)`, `(mouseover)` and `(mouseout)` to the views
that listen, and `(dblclick)`, `(contextmenu)` (a secondary click or Control-click) and `(wheel)`
reach the view under the pointer. The cursor is the nearest CSS `cursor` under the pointer, shown
as AppKit's cursor for it (the arrow for one AppKit has none of), and the I-beam over a text
input. `scrollbar-width: thin` draws small scrollers and `none` hides them. A click focuses a
focusable view, and a focus a key moved reports `focusVisible` and draws AppKit's focus ring
unless the view styles `outline`.

The platform controls are AppKit's own, sized for Yoga at their `controlSize`: `<native-button>`
is an NSButton (Return presses a `default` one and Escape a `cancel` one), `<switch>` an NSSwitch,
`<activity-indicator>` an NSProgressIndicator, `<segmented-control>` an NSSegmentedControl and
`<date-time-picker>` an NSDatePicker. A multiline `<text-input>` is an NSTextView and a
`secureTextEntry` one an NSSecureTextField. `<search-field>` is not drawn yet.

Tab and Shift-Tab move the focus in the order the core walks (`focus-order.h`), not AppKit's
key-view loop: positive `tabIndex` first, then focusable views, text inputs and controls in tree
order, inside the container the focus is in. With the Mac's default keyboard navigation Tab
reaches text inputs only, and Option-Tab reaches everything. A view's accessibility props give it
its NSAccessibility role, subrole, label, hint, value and state (`accessibility.h`); a role AppKit
lacks, such as a heading, is a group with that role's name spoken.

When the app has them installed, the host compiles in the Fabric components of
`react-native-screens` and `react-native-safe-area-context`:

- A native stack keeps every screen mounted, shows the top one and hides those below it, and sends
  `willAppear` and `appear` (which the router waits for) as a screen comes to the top. Push and pop
  swap at once.
- The header of the screen in front is the window's toolbar: its title is the window title, a back
  chevron leads when there is a screen below, bar buttons and their menus sit at their side, and a
  header item's own content moves into a toolbar item.
- The window's content runs under the title bar and toolbar, and each safe-area view gets the part
  of the window's safe area it overlaps: `RNCSafeAreaProvider`'s `insetsChange` (with the window
  controls' width as `titlebarLeading`), `RNCSafeAreaView` and `RNSSafeAreaView`.
- A screen whose `stackPresentation` is not `push` is presented over its stack, as a `<modal>`
  is: `modal`, `formSheet` and `pageSheet` as a sheet on the window, `fullScreenModal`,
  `transparentModal` and the contained ones as a cover in the window, and one with an `anchor`
  (which `present()` writes) as an NSPopover at that view. The screen under it stays showing and
  keeps the toolbar. A sheet has no toolbar, so it draws the screen's header itself: the title as
  a heading at the top, and the bar buttons as a row at the bottom right, the left ones first,
  the first of those on Escape, and the last of the row the default button on Return. A popover
  draws no header and takes the title as its accessibility label. Escape, Cmd-W and a click
  outside a popover send `dismissed`.
- The tabs (`RNSTabsHostIOS`) are the window's sidebar: its source list holds the tabs and the
  content pane shows the selected screen. The tabs outlet commits the props it commits on iOS,
  and the host keeps iOS's selection handshake: the app's `navStateRequest`, stale and repeated
  requests refused, `preventNativeSelection`, and `tabSelected` with its provenance (`user` for a
  click, `programmatic-js` for a request). The first tab shows until the app asks for one, and
  the tabs not selected stay mounted, neither drawn nor hit.

## Drops, drags and opened files

A view with `fileDrop` set takes files, text and URLs dragged onto it from Finder or another app. A
drag goes to the nearest view under it that takes drops: that view gets `dropEnter` when the drag
comes over it, `dropLeave` when the drag goes off without dropping, and `dropPerform` on a drop,
which ends the drag without a leave. Enter and perform carry `{ files: [{ uri, name }], text, urls
}`, a file as its `file://` URL and its name. While a drag is over a view that takes drops the
pointer shows a copy. Dropped text is kept unless it only repeats a URL or a file's path.

A view with `dragItem` set (`{ files, text, url }`) can be dragged out. A press that moves past
AppKit's drag threshold on it, or on a view inside it, becomes an NSDraggingSession: Finder takes the files, a
text field the text and a browser the URL, and a view that takes drops takes any of them. The press
is cancelled for the views under it, so a drag out is not also a click.

A file from Open With, a drop on the Dock icon or a double click on one of the app's document types
reaches `Linking` as its `file://` URL: the initial URL when the app is still launching, a `url`
event after that. Links to the app's scheme arrive the same way.

## Undo

`NgNativeUndo` keeps the app's undo history in one NSUndoManager shared by every window, which
`UndoStack` in `@ng-native/device` registers actions with. Edit > Undo and Edit > Redo name the
last action and send `{ type: 'undo', id }` or `{ type: 'redo', id }` on `ngNativeUndo`. A focused
text input keeps its own history, so typing is undone there and the app's actions where nothing
is focused. A reload clears the history.

## Notifications

`NgNativeNotifications` is `@ng-native/expo`'s `Notifications` over UNUserNotificationCenter:
permission, scheduling (an interval, a date, or a calendar trigger, repeating or not), the pending
and delivered lists, cancelling, dismissing and the badge count. Only `requestPermissionsAsync`
asks the user. Without permission `scheduleNotificationAsync` resolves null and schedules nothing,
and a host binary with no bundle identifier (a dev run outside an app) cannot use the notification
centre and answers denied. A notification that arrives while the app is in front shows as a banner
with its sound. The host sends `ngNativeNotifications` events on `DeviceEventEmitter`, `{ type:
'received', notification }` as one is delivered and `{ type: 'response', response }` when the user
clicks one, which the service reads as `latest()` and `response()`. A date crosses as milliseconds.

The Dock badge is the badge count: `setBadgeCountAsync` sets it, 0 clears it, and a delivered
notification with `content.badge` sets it too. It needs no permission.

## Sidebar

`<split-view>` is `NgNativeSplitView`, holding the sidebar pane (`NgNativeSidebar`) and then the
content pane (`NgNativeSplitContent`). The first split view in a window is the window's
NSSplitViewController, with the full-height sidebar, the toolbar's sidebar button and tracking
separator, View > Show Sidebar and an autosaved width; one inside another split view, a modal or
the tabs is a plain NSSplitView in the content. Each pane is sized by AppKit, and the size goes
back into layout, at most once a display frame. The sidebar's collapsed state follows the app's
`collapsed`, and the title bar button, the View menu and a restored autosave report theirs with
`topSidebarCollapse`.

Neighbouring `<sidebar-section>`s (`NgNativeSidebarSection`) in one parent are one NSOutlineView
source list, laid out where Yoga put them, and each `<sidebar-item>` (`NgNativeSidebarItem`) is a
row of it with its label, badge and SF Symbol. A click selects a row and sends
`topSidebarSelect` to its item. An item with content is a custom row: its views sit in a cell of
their own, which they fill, and a click on a pressable in it reaches the pressable while other
clicks select the row.

## Processes and Shell

`NgNativeProcesses` runs the programs the plugin options' `capabilities` declare, with
`posix_spawn` and never through a shell. The core checks every call again against those
capabilities, from `NGNCapabilities` in a packaged app's `Info.plist` or the `--capabilities` that
`ng-native-desktop run` passes: a program and its arguments must match a `spawn` rule, the program
gets only the `env` variables declared, and its output and exit arrive as `ngNativeProcesses`
events. A Mac App Store (`mas`) build spawns nothing.

`NgNativeShell` hands a URL, a path or a Finder selection to the OS through NSWorkspace. It refuses
`file:`, script and `data:` URLs, and paths that are not absolute and normalised.

## Expo modules

Some of `@ng-native/expo`'s services answer from modules of the host's own, named `NgNative` and
the package's name after `expo-`, each with the methods the service calls on the Expo package:

| Module                | What it does                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NgNativeSecureStore` | Items in the Keychain, under the app's id or the `keychainService` a call names, refusing the keys `expo-secure-store` refuses.                                                 |
| `NgNativeClipboard`   | Reads and writes the pasteboard's text. `Clipboard.changes()` counts its `ngNativeClipboard` events on `DeviceEventEmitter`, sent when the pasteboard's change count has moved. |
| `NgNativeKeepAwake`   | Keeps the display awake with an IOKit power assertion while any tag holds it.                                                                                                   |
| `NgNativeHaptics`     | Plays the trackpad's feedback for an impact, a selection and a notification.                                                                                                    |

The clipboard has no change notification, so the host checks the count when the app becomes active
and after each key press, click and menu command, and never polls.

The other services with a desktop source in `DESKTOP_MODULES` throw `MissingModuleError` on first
use until the host has their module.

## Run the app

```sh
npm start            # the Expo CLI's dev server, in one terminal
npx ng-native-desktop run
```

Run it from the app's directory. The app's Expo config must list `macos` in `expo.platforms` with
`expo.experiments.outOfTreePlatforms` set to `true`; the command says so when it does not.

With no bundle, the host loads
`http://localhost:8081/.expo/.virtual-metro-entry.bundle?platform=macos&dev=true` straight from the
dev server and stays connected to it: an edit Fast Refreshes and keeps state, the dev server's
reload reloads, and so does Developer > Reload (Command-R). A bundle path (from
`npx expo export -p macos`) or another URL can be given instead.

The host is built against the app's own `react-native` (0.88), the first time into
`~/Library/Caches/ng-native/desktop/rn-<version>`, which takes a few minutes and needs Xcode's
command line tools, CMake and Ninja. Later runs reuse it, and adding or removing one of the
libraries above recompiles only that library.

| Option            | What it does                                              |
| ----------------- | --------------------------------------------------------- |
| `--module <name>` | The registered app to start. Default `main`.              |
| `--port <port>`   | The dev server's port. Default `8081`.                    |
| `--universal`     | Build for arm64 and x86_64. Default: this Mac's own arch. |

## Config

The macOS build reads what Expo already has a key for from that key, the one the iOS build reads:
`ios.bundleIdentifier`, `scheme` (and `ios.scheme`), `ios.icon` or `icon`, `version`,
`ios.buildNumber`, `updates.url`, the usage strings in `ios.infoPlist` and each `expo-*` plugin's
permission option. The plugin options hold only what has no Expo key:

```json
{
  "expo": {
    "plugins": [
      [
        "@ng-native/desktop",
        {
          "documentTypes": [{ "name": "Markdown", "extensions": ["md"] }],
          "capabilities": {
            "spawn": [{ "program": "git", "args": ["status", "--porcelain"] }],
            "env": ["HOME"],
            "paths": [{ "path": "~/Projects", "access": "readwrite" }]
          },
          "deny": ["react-native-some-library"]
        }
      ]
    ]
  }
}
```

Expo runs the plugin whenever it reads the config, so an option that is not valid stops
`expo start`, `expo export` and `ng-native-desktop` with every problem listed. The plugin changes
nothing in the config.

## Native code

`run` and `package` find the native code the host compiles in, the way Expo's autolinking does: a
library whose `expo-module.config.json` lists `macos` and names its `macos.cmakeTarget` (and
`macos.cmakeDir`, `desktop` by default), and the app's own `modules/<name>/macos/` folders. They
write what they found to `.expo/ng-native-desktop/link.json` in the app, which the host build reads
from `NGN_DESKTOP_LINK`, and warn about dependencies with native code for iOS or Android and none
for the desktop. `deny` in the plugin options keeps a package out.

## Package the app

`ng-native-desktop package [--format app|dmg|mas] [--output <dir>] [--feed-url <url>]
[--sparkle-key <key>]` builds a
universal release host, bundles with `expo export:embed --platform macos` (the assets laid out as
React Native's resolver reads them beside an embedded bundle), and assembles
`<output>/<name>.app`: the host binary as `Contents/MacOS/<name>`, the bundle and assets in
`Resources`, the icon compiled by `actool`, and an `Info.plist` from the Expo keys. Then `app` is
signed ad hoc, `dmg` is signed with the hardened runtime, notarised and stapled (app and disk
image), and `mas` is signed in the App Sandbox and wrapped by `productbuild`. `codesign`,
`notarytool`, `stapler`, `hdiutil`, `ditto`, `sips`, `actool` and `productbuild` are Xcode's.

`NGN_LOG_COMMITS=1` in the host's environment logs each commit's time to stderr as `[ngn] commit N
ms`, which `pnpm bench:macos` reads. It is off by default, since an animation commits every frame.

The host reads these `Info.plist` keys when it is opened with no arguments:

| Key                                                      | What it holds                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `NGNBundleFile`                                          | The bundle in `Resources`: `main.jsbundle`                                                 |
| `NGNModuleName`                                          | The registered app to start: `main`                                                        |
| `NGNDistribution`                                        | `app`, `dmg` or `mas`, which says what is absent                                           |
| `NGNCapabilities`                                        | The plugin options' `capabilities`: `spawn`, `env` and `paths`                             |
| `NGNUpdatesURL`                                          | `updates.url`, the bundle server                                                           |
| `NGNRuntimeVersion`                                      | `runtimeVersion`, where it is a string                                                     |
| `SUFeedURL`                                              | Sparkle's appcast, in a `dmg` packaged with `--feed-url`                                   |
| `SUPublicEDKey`                                          | Sparkle's public EdDSA key, from `--sparkle-key` or `NGN_SPARKLE_PUBLIC_KEY`               |
| `SUEnableAutomaticChecks`                                | `true` beside a feed, so Sparkle checks without asking first                               |
| `NGNUpdatesCodeSigningCertificate`                       | The PEM at `updates.codeSigningCertificate`, which update manifests are checked against    |
| `NGNUpdatesCodeSigningKeyId`, `NGNUpdatesCodeSigningAlg` | `updates.codeSigningMetadata`'s `keyid` and `alg`: `main` and `rsa-v1_5-sha256` unless set |

`--feed-url` copies `Sparkle.framework` from the host build's `appkit` folder, and stops when the
build has none, or when there is no public key to check updates with.

## Layout

- `native/core`: the toolkit-free C++ core (mounting, the view tree and hit testing, input and
  hover, Tab order, the app's windows and their autosaved frames (`app-windows.h`), menus,
  shortcuts and the back and forward inputs (`app-menus.h`), the tray and the Dock
  (`tray-and-dock.h`), the split view and the tabs (`split-view.h`, `tabs-host.h`), presented
  screens (`screen-presentation.h`), processes and the shell (`processes.h`), the desktop Expo
  modules (`desktop-expo.h`), the accessibility mapping, the native controls' props and
  measuring, text measurement, the module registry and desktop view props, the dev server
  connection, the default menu bar and React Native's iOS-shaped modules in `src/modules`), with
  tests on an
  in-memory backend that run on Linux and macOS. A backend answers the OS calls through narrow
  interfaces: `network.h` (HTTP and WebSocket) and `system.h` (URLs, alerts, appearance,
  clipboard, preferences, image sizes and the app's data directory).
- `native/appkit`: the AppKit backend and the `ngn-macos` binary.
- `native/scripts`: fetching the pinned sources, building Hermes and building the host.
  `NGN_DESKTOP_CACHE` moves the cache and `NGN_JOBS` caps parallel compiles. `build.sh --library
  <dir>` compiles a library's component codegen and its `common/cpp` in, as React Native's Android
  build does (`codegen-library.sh`, `cmake/libraries.cmake`); the core reads a library's own props
  and state through `core/src/libraries/<name>.cpp`.

```sh
pnpm --filter @ng-native/desktop test:native   # the core and its tests, no Hermes, any OS
pnpm --filter @ng-native/desktop build:host     # the macOS host
```
