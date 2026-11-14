# @ng-native/desktop

The macOS desktop host for Angular Native: React Native's C++ core and Hermes, mounting an app's
views into AppKit, and the `ng-native-desktop` command that builds and launches it. You install the
package and never import it.

Alpha, and early: the host draws views, text, text fields, images, scroll views, modals (as an
in-window cover, or as an NSPopover when the modal has an `anchor`), takes clicks, hover and the
scroll wheel, loads the app from the dev server with reload and Fast Refresh, runs React Native's
layout animations, and has the default menu bar. React Native's iOS modules answer from the core:
Linking, Appearance, AppState, DeviceInfo, PlatformConstants, I18nManager, Alert (NSAlert),
Clipboard, Networking (streaming, progress, cookies, redirects), WebSocket, Blob, FileReader,
ImageLoader and `@react-native-async-storage` (2.x and 3.x, file-backed). It has no sheets or React
Native DevTools yet.

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

## Layout

- `native/core`: the toolkit-free C++ core (mounting, the view tree and hit testing, input and
  hover, Tab order, the app's windows and their autosaved frames (`app-windows.h`), menus, shortcuts and the back and
  forward inputs (`app-menus.h`), the accessibility mapping, the native controls' props and measuring, text
  measurement, the module registry and desktop view props, the dev server connection,
  the default menu bar and React Native's iOS-shaped modules in `src/modules`), with tests on an
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
