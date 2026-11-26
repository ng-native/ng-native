# The desktop host

How `packages/desktop` is laid out, and how a prebuilt host is published. What an app
author needs is on the documentation site, under [Desktop](https://ng-native.com/packages/desktop).

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
- `native/gtk`: the GTK 4 backend and the `ngn-linux` binary: a `GtkWidget` per view, painted as
  GSK render nodes in its `snapshot`, Pango text, a `GtkText` per single-line text input and a
  `GtkTextView` per multiline one (whose placeholder the view draws), and the
  pointer fed to the core's input dispatcher from a capture-phase controller on each surface. A
  ScrollView is a `GtkScrolledWindow` whose document holds the content, telling the core's hit
  test each offset, with classic scroll bars (`gtk-overlay-scrolling` off) taking their gutter from
  the content through `scrollers.h`. An Image reads its source through the core's
  `loadImageSource` (`image-source.h`), which keeps what a GET with no body fetched over http(s) in memory
  for the process, by its url and headers, in place of macOS's URL cache, and GDK decodes it off the UI thread. The XDG desktop
  portals are called through `portal.h`, one GDBus request and response routine of our own, inside
  a sandbox and outside one; where no portal answers (no session bus, as in the dev loop on a Mac),
  each caller falls back to GTK's own path. Linking and Shell open a url, a file or its folder
  through the OpenURI portal, falling back to `GtkUriLauncher` and `GtkFileLauncher`, and KeepAwake
  holds the session idle through the Inhibit portal (`system-access.h`). Notifications show through
  the Notification portal, or GNotification where none answers, and fire from the core's
  `notification-schedule.h`, a schedule kept in a file and run from a timer in the app, since Linux
  has no scheduler (`notifications.h`). DocumentPicker's dialogs are the FileChooser portal's,
  falling back to `GtkFileDialog` (`file-dialogs.h`). Printing draws a window or an image through
  `GtkPrintOperation`, and sends a PDF to the Print portal (`printing.h`). The clipboard is the
  display's `GdkClipboard`, whose text the system keeps as it changes, since GDK reads it
  asynchronously (`host-sources.h`). FileSystem's `watch` is a
  `GFileMonitor` (inotify), and its desktop and downloads folders come from the XDG user-dirs file,
  absent when it names none (`file-system.h`). A `GtkDropTarget` on each surface hands a drag's
  file list or text to the core's input dispatcher, and a drag out the dispatcher starts from a
  `[dragItem]` view is a GDK drag of a file list, a uri list and text (`drag-and-drop.h`). An svg
  draws the core's document of react-native-svg's elements (`svg.h`) with `cairo-canvas.h`, a
  cairo node in the view's snapshot, since GSK fills and strokes paths only from GTK 4.14; text in
  an svg is Pango's, and a `foreignObject`'s views are not drawn.
  Accessibility is GTK's own: each widget is made with the GTK role for the view's ARIA role,
  which the core's `aria-role.h` reads from its `role` or `accessibilityRole`, and its label,
  description, level and states follow the props. GTK fixes a role when it makes the widget, so
  a view whose role changes gets a new widget in its place, with its children and the focus. A
  text input's field is the text box with its label, and its view is generic. On GTK 4.14 and
  later a Paragraph's widget also implements `GtkAccessibleText` (`accessible-text.h`, added at
  run time), so a screen reader reads it by character, word, sentence, line and paragraph, with
  the spans worked out in the core's `text-units.h`; a field is GTK's own GtkText or GtkTextView,
  which implement it themselves. Announcements, a live region's and `Accessibility.announce()`'s
  through the front window, go through `gtk_accessible_announce`, found at run time on GTK 4.14
  and later, and say nothing below. A view's press, increment, decrement and cancel are its
  widget's `accessibility` actions, which GTK lists on AT-SPI's Action interface, and its
  declared actions (`accessibilityActions`) are its `custom` actions, sent to the app as
  `onAccessibilityAction` (`sendAxAction`, which AppKit's custom actions share). GTK gives AT-SPI
  an action's name and no label, so a screen reader reads `custom.<name>`. GTK 4 answers
  AT-SPI's `GrabFocus` with NotSupported, so a screen reader cannot move the keyboard focus. `AccessibilityInfo`'s settings (`accessibility-settings.h`) come from the settings
  portal (its reduced-motion and contrast), GTK's settings and libadwaita's high contrast, through
  the core's `linuxAccessibility`, and the screen reader from AT-SPI's `org.a11y.Status`.
  Below libadwaita 1.6, which draws its own blue, the portal's `accent-color` is applied over
  libadwaita's stylesheet as its accent colours (`accent-colour.h`), worked out as libadwaita 1.6
  does in the core's `accent-colors.h`; from 1.6 libadwaita follows the portal itself. Both read
  the portal through `settings-portal.h`.
  Orca's structural navigation finds no headings or landmarks in a GTK 4 app. It
  builds on Linux against GTK 4.10 or later, libadwaita 1.4 or later and libsecret 0.20 or later
  (SecureStore's, `secret-store.h`), and on a Mac against Homebrew's
  (`brew install gtk4 libadwaita openssl@3 libnghttp2`) as a dev loop, without libsecret, so
  SecureStore is absent there. Its HTTP and WebSocket client is the
  core's libcurl one (`curl-network.h`), which the GTK build turns on (`NGN_CURL`): one thread
  drives every request through `curl_multi`, behaving as NSURLSession does on macOS for redirects,
  timeouts (the longest silence), decoded bodies and `file:` and `data:` urls, and opening a
  WebSocket's `http` or `https` url as `ws` or `wss`, as React Native's HMR client asks. Its
  lasting cookies are kept between launches in `cookies.txt` in the app's data folder, as macOS
  keeps them, and session cookies are not. A proxy comes from libcurl's environment variables (`http_proxy`, `https_proxy`, `ALL_PROXY` and
  the rest) when any is set, else from the desktop's settings, asked for each origin at most every 30 seconds: the
  proxy portal (`org.freedesktop.portal.ProxyResolver`) when one answers, else GLib's
  `GProxyResolver` (`proxy-resolver.h`), which reads GNOME's and KDE's settings only where glib-networking is
  installed. `NO_PROXY` applies to either.
  A request names the app in its User-Agent unless it sets its own, as CFNetwork does on macOS:
  `<name>/<version> ng-native libcurl/<version>`, from `metadata.json`'s `CFBundleName` and
  `CFBundleShortVersionString` in a package, or `--title` and `NGN_APP_VERSION` in a dev run. It runs a `linux`
  bundle, which `expo export` makes once the app's `app.config.js` registers the platform
  (`@ng-native/metro/linux.cjs`). A window is an
  `AdwApplicationWindow` of the app's `AdwApplication`, holding an `AdwToolbarView` with an
  `AdwHeaderBar` on top of a `GtkOverlay` with the surface (`screens.h`). Its `titleBar` decides how
  they meet: `default` keeps the content below a raised header bar, and `transparent` runs it under
  a flat one, as does `hidden`, which also hides the title. Content under the bar reports the bar's
  height as its top inset, and the window controls' reach from each side, wherever
  `gtk-decoration-layout` puts them, as `titlebarLeading` and `titlebarTrailing`. The chrome also
  holds where the app's menus will go, hidden until it has them: a `GtkPopoverMenuBar` under the
  header bar when `XDG_CURRENT_DESKTOP` names KDE, else a primary `GtkMenuButton` in it. The
  front screen's header goes into the header bar as macOS puts it into the toolbar, in the core's
  `headerLayout` order, led by a back and forward pair that follows the window's history
  (`historyButtons`, with a secondary click or a long press listing `historyMenu`), with the
  header's subviews moved into slots of their own, each a container for input, a bar button's menu as a `GtkMenuButton`, the header's tint, title and background
  colours as CSS classes, and a search bar as a `GtkSearchEntry`. The `AdwApplication` is unique
  by the app id, except in a test launch, and handles open: a second launch finds the first on the
  session bus and hands it its links and files (`forwardLaunch`), then exits, and the first raises
  its last active window, or sends `reopen` when it has none shown. `--gapplication-service` starts
  it as the D-Bus service a packaged app's `DBusActivatable` desktop entry names. A window reports
  its size, maximised and full-screen state and focus to the core's `WindowHost`, which saves the
  size and state but no place. An app that listens decides whether closing its last window quits it, by `provideAppLifecycle`'s `quitWhenLastWindowCloses`, as on macOS. With no app listening, the host quits when the user closes the last window and the app's own window is not shown (`WindowHost::lastWindowClosed`); a reload closing a window never quits it. The app's menu bar is a `GMenu` built from the core's items
  (`menus.h`), each item an action of the window's `menu` group, shown in the chrome's menu bar or
  primary menu. GTK's popover menus take no keys, so a window's capture-phase key controller looks a
  press up in order: the app's shortcuts (`MenuHost::keyDown`), the focus keys (`focus.h`: Tab and
  Shift-Tab over the core's `nextInTabOrder` in the focus's container, arrows over `compositeMove`,
  each grabbing real GTK focus), the back and forward keys (`navigationFor`), then the bar
  (`findMenuItem` by chord), leaving a focused text input its
  editing keys; a bubble-phase controller gives an unused Return or Escape to the `default` or
  `cancel` native button. Mouse buttons 8 and 9 go back and forward, and a secondary click on a
  view with a `contextMenu` shows a `GtkPopoverMenu` there. A window shows with nothing
  focused, as on macOS, so a header's search field does not take the focus at launch. A `<modal>`
  sheet, and a screen presented with `present()`, is an `AdwDialog` in a resizable window on
  libadwaita 1.5 and later, found at run time, and a drawn sheet on a dimmed overlay on 1.4 or over
  a window that is not resizable, where libadwaita would open a window of its own; a cover fills
  the overlay below the header bar; one with an `anchor` is a `GtkPopover` pointing at it. While a
  cover or a drawn sheet is shown, the rest of the window takes no pointer or focus: the header
  bars' items, the menu bar or the main menu (and its F10), the content and any layer behind it.
  The window controls still work. A
  `<split-view>` is an `AdwNavigationSplitView` in an `AdwBreakpointBin` (`split-view.h`), each
  pane in a page of its own as a container for input, its size going back to layout as state. The
  window's split view runs the window's full height, as libadwaita lays a window out: each pane is
  under a header bar of its own in an `AdwToolbarView`, and the window's header bar moves over the
  content pane while the split view is there (not in a title-bar mode whose content runs under the
  header bar, where it already spans the window). A menu bar stays across the top, above both panes. The
  core owns collapse (`FoldingSplit`): the bin's breakpoint, at the core's `sidebarCompactWidth`,
  only reports the width, and the split view's `collapsed` and `show-content` show the result. The
  sections are a `GtkListBox` over their frames, drawn from the core's `sourceLists`, and Show
  Sidebar (F9) and the sidebar button go to the window's split view. The button sits at the end of
  the sidebar's own header bar while the sidebar shows beside the content, and in the window's
  header bar once it folds away. A sidebar with an `autosave` name keeps whether it is collapsed in
  the app's preferences, and that state wins over the app's prop on the next launch. An inset
  content pane (`contentStyle="inset"`) is a rounded card on its page, which takes the sidebar's
  colour, the header bar over it drawing none of its own. A cover starts
  below both header bars of a full-height split view. A
  presented screen's header is the sheet's own header bar, with Cancel at the start and bound to
  Escape and the last right item the default on Return. An alert (`alerts.h`) is an
  `AdwAlertDialog` in the active window on libadwaita 1.5 and later, and an `AdwMessageDialog` on
  1.4 or with no window, its buttons in GNOME's order (`gnomeAlertLayout`) and a prompt's fields in
  it. Close Window asks the presentation in
  front of the window to close (`Modals::front`) before the window. Each tray icon is a
  StatusNotifierItem on a session-bus connection of its own (`status-notifier.h`), its menu laid
  out for `com.canonical.dbusmenu` by the core (`dbus-menu.h`); the tray module is left out when no
  StatusNotifierWatcher runs at launch, and the Dock's always is. The badge count goes out as the
  `com.canonical.Unity.LauncherEntry` `Update` signal (`launcher-badge.h`), as the
  notification centre's `showBadge`.
- `native/scripts`: fetching the pinned sources, building Hermes and building the host.
  `NGN_DESKTOP_CACHE` moves the cache and `NGN_JOBS` caps parallel compiles. `build.sh --library
  <dir>` compiles a library's component codegen and its own C++ in, as React Native's Android
  build does (`codegen-library.sh`, `cmake/libraries.cmake`): `common/cpp`, or the one other folder
  holding `react/renderer/components/<name>` (react-native-gesture-handler's `shared/shadowNodes`),
  with each registered descriptor's header found by what it declares, whatever its file is named
  (react-native-keyboard-controller's `RNKC` prefix). The core reads a library's own props and
  state through `core/src/libraries/<name>.cpp`.

```sh
pnpm --filter @ng-native/desktop test:native   # the core and its tests, no Hermes, any OS
pnpm --filter @ng-native/desktop build:host     # the macOS host
```

On Linux, `build.sh --backend gtk` builds `ngn-linux` over the core, Hermes and the runtime half,
and `--test` runs the core, runtime and GTK view tests (`ngn_gtk_tests`, which need a display:
Xvfb on a machine without one). The tray tests also need a session bus, under `dbus-run-session`:
without one they are skipped, and in CI they fail. `build.sh --backend none --runtime --test` still builds the
toolkit-free half alone. Off macOS, Hermes links ICU 77.1, which `fetch.sh` pins and `build-icu.sh`
builds statically, with only English data (`icu-filter.json`). The GTK host links libcurl 8.23.0,
which `fetch.sh` also pins and `cmake/curl.cmake` builds statically with HTTP/1.1, HTTP/2,
WebSockets and nothing else, over the system's OpenSSL 3, nghttp2 and zlib. The CA certificates
are found when the host starts: `SSL_CERT_FILE` or `SSL_CERT_DIR` when set, else the bundle or
directory the distribution keeps. On a Mac the GTK build takes Homebrew's OpenSSL and nghttp2
(`brew install openssl@3 libnghttp2`) through
`PKG_CONFIG_PATH="$(brew --prefix openssl@3)/lib/pkgconfig"`. The build runs in
`native/docker/Dockerfile`, an AlmaLinux 9 image with clang and lld from `llvm-toolset`, GTK 4.12
and libadwaita 1.4, and Xvfb and Weston for launching the host headless. Building against el9
keeps the glibc it needs at 2.34, and the OpenSSL at 3.0, which `native/docker/glibc-floor.sh`
checks. The libcurl client's tests run against a local server, `core/tests/curl/test-server.py`,
so they need `python3`. CI's `host-linux`
job builds the GTK host on x86_64 and arm64, runs its tests, and launches it on the notes example
to its first frame under Xvfb and headless Weston, keeping each window's in-process capture
(`NGN_CAPTURE`) as an artifact. It then reads the same app's accessibility tree over AT-SPI, as a
screen reader would, with pyatspi and no screen reader (`native/scripts/atspi-check.py`). A
packaged Linux app's host takes its settings from the `metadata.json` that `package` writes
beside it, as a macOS app's take them from its `Info.plist`. On a Mac, run the same image with Docker, as a user other than
root, since root reads a file whatever its mode and so fails the core tests that make one
unreadable. The commands are in the Dockerfile's header. `native/docker/Dockerfile.fedora` is the same
image on Fedora, with a newer GTK and libadwaita, where the code a newer libadwaita takes in place of
the 1.4 fallbacks runs: the nightly workflow builds the host and runs the core and GTK tests in it.
On a Mac, `pnpm bench:linux`, the screens-check skill's `linux` mode and `linuxLauncher()` run in
the image `NGN_LINUX_IMAGE` names, `ngn-el9` when it is unset; `ngn-fedora` selects that one, built
from its Dockerfile with `-t ngn-fedora`. On Linux they run where they are.

`ng-native-desktop run` builds the host with `--no-tests` and `package` with `--release`: the
published package has none of the core tests' sources, so only `test:native` and `build:host` in
this repository build them.

## Publishing a prebuilt host

The release workflow (`.github/workflows/release.yml`) publishes two with each release for each
React Native version in `HOST_REACT_NATIVE` (`bin/prebuilt.mjs`), since the CLI takes a host only
for the exact version an app has: the templates'. One version, since each adds a full set of host
builds to every release. A test holds the workflows' matrices and `fetch.sh`'s pins to that list,
and the templates' versions to it. The two are the `debug` host, the dev build (`build.sh
--universal --no-tests`) with React Native's debugger, which `run` downloads, and the `release`
host, the Release build (`build.sh --universal --release`), which `package` downloads.

1. Its `desktop-host` job, once per React Native version and flavour, builds the universal host
   against `examples/canary`, which has every host library but `react-native-webview` (an app with
   it builds the host from source), signs it ad hoc and packs it with
   `native/scripts/make-prebuilt.mjs examples/canary .prebuilt --react-native <version> --flavour <flavour> --version <release> --base-url <url>`,
   where `<url>` is the release's downloads URL. For a version other than the canary's,
   `--react-native` installs it with npm, beside the canary's host library versions, into a folder
   in that version's build cache named for those versions. The entry goes into
   `.prebuilt/prebuilt-host-rn-<version>-<flavour>.json`.
2. The release job writes every entry, each with its version, flavour and SHA-256, into
   `packages/desktop/prebuilt.json` before the packages are packed, so the npm package names every
   archive. It stops when one is missing.
3. Every archive goes up with the GitHub release.

It publishes the Linux hosts too, both flavours for x64 and arm64, for each version. Its
`desktop-host-linux` job, once per React Native version, architecture and flavour on a runner of
that architecture, runs
`.github/actions/desktop-prebuilt-linux`: it builds the AlmaLinux 9 image (`native/docker`), runs
`make-prebuilt.mjs examples/canary .prebuilt --os linux --react-native <version> --flavour <flavour> ...` in it, which builds
`build.sh --backend gtk`, strips `gtk/ngn-linux` and `gtk/hermesc` and packs them as
`...-linux-<arch>[-debug].tar.gz` with the entry `prebuilt-host-rn-<version>-linux-<arch>-<flavour>.json`,
and checks the packed host needs glibc 2.34 at most. The release job writes every entry
(`RELEASE_HOSTS` in `bin/prebuilt.mjs`) and stops when one is missing. A Linux host is reused or
packed from the Actions cache as a macOS one is (below), with `--print-key`, `--reuse` and
`--host-cache` run in the image. Its key adds the OS and architecture, and takes in place of the
SDK the image's glibc and the versions pkg-config gives for the libraries the host builds against;
the image's Dockerfile and the ICU pin are among the native sources it already covers. The cached
host is kept only from `main`, as the ccache set is. The Desktop host workflow's
`prebuilt-host-linux` job runs the same action on a push to `main` that changed the host's inputs,
and on a manual run on any branch, keeping each archive as an artifact.

A host is built only when something it is built from changed. `make-prebuilt.mjs --print-key`
computes the key of its inputs: the host's native sources and build scripts, React Native's and
each compiled-in library's version, the flavour, the compiler, the SDK and the signing identity.
Each entry in `prebuilt.json` records it as `inputs`. The job, through
`.github/actions/desktop-prebuilt`, then takes the first of these that applies:

- The last release's entry in the checked-out `prebuilt.json` has the same key: `--reuse`
  downloads its archive, checks it against the entry's SHA-256 and publishes it again, byte for
  byte, under the new release's name.
- An Actions cache holds a host built from the same key: `--host-cache` strips, signs and packs it.
  Every file is checked against the digest saved with it.
- Otherwise it builds, with ccache, the universal Hermes and the fetched sources restored, and
  keeps the unsigned host in the Actions cache under its key.

A key that cannot be computed, a failed download, a checksum that does not match or a cached file
that changed falls through to the next, and the last always builds. The Desktop host workflow's
`prebuilt-host` job runs the same action on a push to `main` that changed the host's inputs, so a
release finds those caches warm.

`prebuilt.json` holds one entry per React Native version and flavour:

```json
{
  "version": 1,
  "hosts": [
    {
      "reactNative": "0.88.1",
      "flavour": "debug",
      "url": "https://github.com/coralogix/ng-native/releases/download/v<release>/ng-native-desktop-host-<release>-rn-0.88.1-macos-universal-debug.tar.gz",
      "sha256": "<64 hex digits>",
      "libraries": { "react-native-screens": "<version>" },
      "inputs": "<64 hex digits>"
    },
    {
      "reactNative": "0.88.1",
      "flavour": "release",
      "url": "https://github.com/coralogix/ng-native/releases/download/v<release>/ng-native-desktop-host-<release>-rn-0.88.1-macos-universal.tar.gz",
      "sha256": "<64 hex digits>",
      "libraries": { "react-native-screens": "<version>" }
    }
  ]
}
```

An entry with no `flavour` is a release host. A command with no entry of its flavour builds the
host from source.

To publish a host by hand, for another React Native version or another app, run `make-prebuilt.mjs`
with `--flavour`, `--react-native` for a version the app does not have, and `--manifest
prebuilt.json` to write its entry, for each flavour, commit
`prebuilt.json`, and attach both archives to the GitHub release at `<url>`.
