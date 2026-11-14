# @ng-native/desktop

The macOS desktop host for Angular Native: React Native's C++ core and Hermes, mounting an app's
views into AppKit, and the `ng-native-desktop` command that builds and launches it. You install the
package and never import it.

Alpha, and early: the host draws views, text, text fields, images, scroll views, modals (as a
sheet, an in-window cover, or an NSPopover when the modal has an `anchor`), takes clicks, hover
and the scroll wheel, loads the app from the dev server with reload and Fast Refresh, runs React
Native's layout animations, and has the default menu bar. React Native's iOS modules answer from
the core: Linking, Appearance, AccessibilityInfo, AppState, DeviceInfo, PlatformConstants,
I18nManager, Alert (NSAlert), Clipboard, Networking (streaming, progress, cookies, redirects),
WebSocket, Blob, FileReader, ImageLoader and `@react-native-async-storage` (2.x and 3.x,
file-backed). It has no React Native DevTools yet.

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
when its first frame mounts, or once the app hides the splash screen it holds
(`NgNativeSplashScreen`). The close button, Cmd-W, Cmd-Q and a logout ask the app, which closes
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
its NSAccessibility role, subrole, label, hint, value and state, selected, disabled, checked and
expanded included (`accessibility.h`). Every role the components take is mapped; one AppKit lacks,
such as `navigation`, is a group with the role's name spoken, and a heading is AppKit's heading role
with its `accessibilityLevel` from macOS 26 (a group spoken as a heading before). A text is static
text whose value is its string. A control, a heading or an `accessible` view is read as one element,
named by the text inside it when it has no label, and a view with a role or a label keeps its
children under it so that text is there to read. `AccessibilityInfo` reads
VoiceOver's state, reduce motion, reduce transparency, invert colours and increase contrast from
NSWorkspace, and sends their change events from its notifications; macOS has no bold-text or
grayscale setting, so those answer false.

VoiceOver's actions come from `accessibilityActions`: `activate` is its press, `increment` and
`decrement` step an adjustable view, `escape` is its cancel, and any other is a custom action by its
label, sent back as `(accessibilityAction)`. VoiceOver's press (VO-Space), and Space or Return on a
focused view, send `(accessibilityTap)` or `activate` when the view listens for them, and otherwise
click the view at its centre, as iOS's synthesized tap does, so a `(press)` handler runs.

`announceForAccessibility` posts an announcement VoiceOver says, interrupting unless it asks to
queue or for low priority, and `setAccessibilityFocus` points VoiceOver at the view (and gives a
focusable view the keyboard). A live region (`accessibilityLiveRegion`, `aria-live`) says nothing
as it appears; after that each change to its text is announced, politely or, for `assertive`,
interrupting. Its text is its label, or else the text of the views under it, which the region keeps
under it rather than letting Fabric flatten them beside it (`live-regions.h`). macOS reports no end
to an announcement, so `announcementFinished` never fires.

The app's content in a window is one group to VoiceOver, holding its Headings, Links and Landmarks
rotors over the views inside it, in tree order: headings, links, and the views with a landmark role
(`banner`, `main`, `navigation`, `complementary`, `contentinfo`, `form`, `region`). AppKit fills
none of these for drawn views.

When the app has them installed, the host compiles in the Fabric components of
`react-native-screens`, `react-native-safe-area-context` and `react-native-svg`:

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
- An svg (`RNSVGSvgView`, which `@ng-native/icons` commits) draws its elements with Core Graphics:
  groups, paths, rects, circles, ellipses and lines, linear and radial gradients, clip paths,
  luminance masks, `use` and `symbol`, images, and text in spans, with presentation inherited
  through `propList` and `currentColor` from the svg's `color`. Markers, patterns, filters,
  `foreignObject` and `textPath` draw nothing, and text has no anchor, path or letter spacing.

## Drops, drags and opened files

A view with `fileDrop` set takes files, text and URLs dragged onto it from Finder or another app. A
drag goes to the nearest view under it that takes drops: that view gets `dropEnter` when the drag
comes over it, `dropLeave` when the drag goes off without dropping, and `dropPerform` on a drop,
which ends the drag without a leave. Enter and perform carry `{ files: [{ uri, name }], text,
urls }`, a file as its `file://` URL and its name. While a drag is over a view that takes drops the
pointer shows a copy. Dropped text is kept unless it only repeats a URL or a file's path.

A view with `dragItem` set (`{ files, text, url }`) can be dragged out. A press that moves past
AppKit's drag threshold on it, or on a view inside it, becomes an NSDraggingSession: Finder takes
the files, a text field the text and a browser the URL, and a view that takes drops takes any of
them. The press is cancelled for the views under it, so a drag out is not also a click.

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
events. A Mac App Store (`mas`) build spawns nothing. A spawned program gets SIGTERM when the app
reloads, and every program still running gets SIGKILL when the app quits.

`NgNativeShell` hands a URL, a path or a Finder selection to the OS through NSWorkspace. It refuses
`file:`, script and `data:` URLs, and paths that are not absolute and normalised. `Linking`
refuses the same URLs. `openPath` opens a document in its app and refuses a path that is not
there, a program, an app, a script and a location file, since those would run or follow a link past
the `spawn` rules.

## Launch settings

A dev run takes its bundle, module, title, app id and capabilities from the command line, and
settings such as the updates URL from `NGN_*` environment variables. A packaged app, whose
`Info.plist` names `NGNBundleFile`, takes all of them from its `Info.plist` and ignores argv and
the `NGN_*` variables, so nothing that launches the app can make it run another bundle, as another
app, or take updates from another server.

## Expo modules

Some of `@ng-native/expo`'s services answer from modules of the host's own, named `NgNative` and
the package's name after `expo-`, each with the methods the service calls on the Expo package:

| Module                                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NgNativeSecureStore`                   | Items in the Keychain (the Data Protection keychain when the app is signed with a Team ID and an app identity), under the app's id or the `keychainService` a call names, refusing the keys `expo-secure-store` refuses.                                                                                                                                                                                                                                                                                                                                                                                       |
| `NgNativeClipboard`                     | Reads and writes the pasteboard's text. `Clipboard.changes()` counts its `ngNativeClipboard` events on `DeviceEventEmitter`, sent when the pasteboard's change count has moved.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `NgNativeKeepAwake`                     | Keeps the display awake with an IOKit power assertion while any tag holds it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `NgNativeHaptics`                       | Plays the trackpad's feedback for an impact, a selection and a notification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `NgNativeSqlite`                        | `expo-sqlite`'s databases over the system's sqlite3. See Sqlite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `NgNativeLocalAuthentication`           | `Biometrics` over LAContext. See Local authentication.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `NgNativeFileSystem`                    | `FileSystem`'s files over uris. See File system.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `NgNativeLocation`                      | The foreground permission, one fix and a watch over CLLocationManager, and geocoding over CLGeocoder. See Location.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `NgNativeCrypto`                        | `Crypto` over CommonCrypto and the system's secure random source: UUIDs, random bytes and the SHA-1, SHA-2, MD2, MD4 and MD5 digests. Bytes cross as `{base64}`, and the desktop loader answers them as `Uint8Array` and `ArrayBuffer`.                                                                                                                                                                                                                                                                                                                                                                        |
| `NgNativeNetwork`                       | `Network` over Network.framework's path monitor: connected and reachable when a route exists, and the type of the interface it uses (`WIFI`, `ETHERNET`, `CELLULAR`, `OTHER`, or `NONE`). Changes arrive as `ngNativeNetwork` events.                                                                                                                                                                                                                                                                                                                                                                          |
| `NgNativeBattery`                       | `Battery` over IOKit's power sources and Low Power Mode: the level, and `UNPLUGGED`, `CHARGING`, `FULL` or `NOT_CHARGING` (on the adapter and held below full). A Mac with no battery answers -1 and `UNKNOWN`. Changes arrive as `ngNativeBattery` events.                                                                                                                                                                                                                                                                                                                                                    |
| `NgNativeFont`                          | `Fonts` over CTFontManager: registers a font file for the app's process under a name, from a `file:` uri or downloaded from the dev server first. Text that asks for the name is set in that font's family, with its weight picked among the faces loaded, as `expo-font`'s alias does on iOS.                                                                                                                                                                                                                                                                                                                 |
| `NgNativeWebBrowser`                    | `Browser`: `open()` hands an http or https url to the default browser, by the url policy Linking and `Shell` use, and `signIn()` runs an ASWebAuthenticationSession on the key window, ending on the redirect url's scheme, one at a time. With `NGN_NO_PROMPTS=1` a sign-in answers as cancelled without starting.                                                                                                                                                                                                                                                                                            |
| `NgNativeTextRecognition`               | `TextRecognition` over Vision, as the iOS module: the lines in an image file, each with its confidence and its box in pixels from the top left, the file's orientation applied.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `NgNativeCalendar`                      | `Calendar` over EventKit: the calendar and reminders permissions (write-only access grants a write-only ask), and with full access the calendars, the default calendar, the sources and the events in a range, as plain records. It asks only when the app's `Info.plist` has the usage string, and with `NGN_NO_PROMPTS=1` never. Without access it reads nothing. Creating a calendar and reading a reminder are not answered.                                                                                                                                                                               |
| `NgNativeStoreReview`                   | `StoreReview`: in a Mac App Store (`mas`) build, `request()` asks SKStoreReviewController for the system's rating prompt (not with `NGN_NO_PROMPTS=1`); in any other build it is inert and `available()` is false. `storeUrl()` is null.                                                                                                                                                                                                                                                                                                                                                                       |
| `NgNativeAudio`                         | `audioPlayer` and `audioRecorder` over AVPlayer and AVAudioRecorder. A player plays a `file:` or `http(s):` source or an asset, with its rate (0 to 2, pitch kept), volume, mute and loop, and sends expo-audio's status as it loads, plays, seeks and ends, and at its update interval while it plays. A recorder records to the app's caches with the `ios` options, once the microphone is allowed: it asks only when the app's `Info.plist` has `NSMicrophoneUsageDescription`, never with `NGN_NO_PROMPTS=1`, and a Mac with no microphone cannot prepare one. No audio sampling or lock screen controls. |
| `NgNativeLocalLlm`                      | `LanguageModel` over Apple's Foundation Models on macOS 26 and later, as `expo-local-llm` on iOS: the availability (`notEligible` before macOS 26, `notEnabled` with Apple Intelligence off, `notReady` while the model is prepared), sessions with instructions and sampling options, answers whole or streamed, structured answers to a schema, and tools whose calls the app answers. It checks the availability again when the app comes to the front.                                                                                                                                                     |
| `NgNativeScreenCapture`                 | `ScreenCapture`: while any key is held, every window of the app, the ones it opens after and the system's panels among them, has an NSWindow `sharingType` of none, which keeps it out of screenshots, recordings and screen sharing. A reload lets capture back. macOS tells an app of no screenshot, so `screenshots` stays at zero, and it shows no snapshot of an app in the background, so `protectAppSwitcher()` does nothing.                                                                                                                                                                           |
| `NgNativeSplashScreen`                  | `splashScreen`: a Mac app has no launch screen, so holding the splash keeps the app's first windows hidden past their first frame until `hideAsync()`, which shows them in the order they were ready. A hold after a window has shown answers false and holds nothing, and a reload lets the held windows show.                                                                                                                                                                                                                                                                                                |
| `NgNativeMediaLibrary`                  | `MediaLibrary` over PhotoKit: the read and add-only permissions, queries with every filter, sort, limit, offset and album, each asset's details and file, saving a file (into an album too), favourites, deleting, albums and their assets, and the library's changes once something watches. It asks only when the app's `Info.plist` has `NSPhotoLibraryUsageDescription` (or `NSPhotoLibraryAddUsageDescription` for saving), never with `NGN_NO_PROMPTS=1`, and without access reads nothing and refuses every write. macOS has no limited library, so `presentPermissionsPicker()` does nothing.          |
| `NgNativeImagePicker`                   | `ImagePicker`'s library half: `pick()` shows the system's photo picker as a sheet on the key window, which needs no permission, and copies what is picked into the app's caches. `libraryPermission` is the photo library's. macOS has no system camera to open, so `capture()` answers nothing and the camera permission is denied.                                                                                                                                                                                                                                                                           |
| `NgNativeTrackingTransparency`          | `Tracking` over App Tracking Transparency: the permission, asked only when the app's `Info.plist` has `NSUserTrackingUsageDescription` and never with `NGN_NO_PROMPTS=1`, and the advertising identifier once tracking is allowed (null where macOS answers zeros).                                                                                                                                                                                                                                                                                                                                            |
| `NgNativeImageManipulator`              | `ImageEditor` over ImageIO and Core Graphics, as `expo-image-manipulator` on iOS: resize (to a width or a height keeping the ratio), rotate, flip and crop, applied in order to the image the right way up, after scaling it into `maxWidth` and `maxHeight`, and saved as JPEG at the `compress` quality or as PNG into the app's caches, with its base64 when asked. The source is a `file:` uri, a path, a `data:` uri or an asset from the dev server. macOS cannot write WebP, so saving as WebP rejects.                                                                                                 |
| `NgNativePrint`                         | `Printing` over NSPrintOperation: `print()` shows the print panel as a sheet on the key window (app-modally with none) for HTML, laid out by WebKit, or for the PDF or image a `file:`, `data:` or `http(s):` uri names, and resolves once it closes, printed or cancelled. `printToPdf()` lays the HTML out on pages of its size (US Letter by default) into a PDF in the app's caches, breaking pages where the CSS asks. macOS has no printer picker: `selectPrinter()` answers null and a printer passed to `print()` is ignored. With `NGN_NO_PROMPTS=1` `print()` shows nothing.                         |
| `NgNativeAddressSearch`                 | `AddressSearch`, the module the iOS app has, over MapKit: a completer for each search, suggesting as the query changes (later answers for the same query arrive as `ngNativeAddressSearch` events), and `MKLocalSearch` for the address of a picked suggestion of the latest answer. The `region` option looks only in that country from macOS 15, and there first before. It needs no permission.                                                                                                                                                                                                             |
| `NgNativeAsset`                         | `assets()`: each module resolves as an image's does, and its `localUri` is its file on the Mac. An asset the dev server serves is downloaded into the app's caches as `ExponentAsset-<hash>.<type>` first, once per hash; a packaged app's is the file in the app.                                                                                                                                                                                                                                                                                                                                             |
| `NgNativeSymbol`                        | `<expo-symbol>`'s size: the symbol image's at a point size, weight and scale, as the iOS module answers it. The host draws the view itself (`ViewManagerAdapter_SymbolModule`) with AppKit's symbol configuration: the type, tint, palette, weight and scale, built at the system font size and placed by `resizeMode`, as `expo-symbols` does on macOS. `animationSpec` plays nothing.                                                                                                                                                                                                                        |
| `NgNativeApplication`, `NgNativeDevice` | `AppInfo`: the bundle's version, build, id and name (a dev run, with no bundle, gives the app's id and name and no versions), and the Mac's model, macOS version and `desktop` device type.                                                                                                                                                                                                                                                                                                                                                                                                                    |

`@ng-native/device`'s `Sharing` uses `NgNativeSharing` on macOS, where React Native's `Share` has
no implementation. It shows AppKit's share picker below the top of the key window's content, with
the message as text and the url as a link, or as the file itself for a `file:` uri or a path, and
gives the picked service the title as its subject. A share answers as shared once the service has
shared, and as dismissed when the picker closes, the service fails, no window is showing, or
`NGN_NO_PROMPTS=1` is set.

The clipboard has no change notification, so the host checks the count when the app becomes active
and after each key press, click and menu command, and never polls.

### Sqlite

`database()` opens its database through `NgNativeSqlite`. A TurboModule cannot return an object
with methods, so the host answers a handle, `{id, databasePath, databaseName}`, and each call takes
the id first; the desktop loader builds `expo-sqlite`'s database on it, with each call also in its
`Sync` form. A file database lives in `<appData>/SQLite`, uses the WAL journal, and cannot be named
with a path that leaves that folder; `:memory:` is in memory. `withTransactionAsync` runs `BEGIN`,
the task, then `COMMIT`, or `ROLLBACK` when the task throws. Blobs cross as `{base64}` and come
back as bytes. A reload closes every open database. Calls run on the JavaScript thread, in order.

The host answers a row without a column list, so a row's keys are not in the order of the `SELECT`.
`prepareAsync` and `serializeAsync` throw, and `getEachAsync` reads every row before it yields the
first.

### Local authentication

`NgNativeLocalAuthentication` answers `Biometrics` over LAContext: Touch ID, the login password and
an Apple Watch. The password stands in for Touch ID unless `disableDeviceFallback` is set, and with
it set a call that Touch ID cannot answer (no sensor, nothing enrolled, locked out, the lid closed)
fails at once with no prompt. With `NGN_NO_PROMPTS=1` in the environment no prompt is ever shown,
and every evaluation fails as `not_interactive`, so an automated run never waits on a dialog.

### Location

`NgNativeLocation` answers `Location`'s permission, `current()` and `start()` over
CLLocationManager. It asks for the permission only when the app's `Info.plist` explains why
(`NSLocationUsageDescription` or `NSLocationWhenInUseUsageDescription`), since macOS shows no prompt
without one, and with `NGN_NO_PROMPTS=1` never. Without the permission it reads nothing, and
`current()` answers null. `geocode()` and `reverseGeocode()` ask CLGeocoder, which needs no
permission and answers in `expo-location`'s iOS shapes: an address no place matches is an empty
list, and a geocoder out of reach (offline or rate limited) rejects.

### File system

`NgNativeFileSystem` answers flat calls over `file:` uris, and the desktop loader builds the
service's files on them: `paths` names `cache`, `document`, `appData`, `temp`, `home`, `desktop`
and `downloads`, each left out where the app cannot reach it. `document` is `<appData>/Documents`,
not `~/Documents`. A call reaches the app's own folders, the files and folders the user picked in
a panel (until the app quits), and the paths the plugin options' `capabilities.paths` declare,
read-only or read-write, after symbolic links are followed. `watch` reports changes from FSEvents.

Each call is answered synchronously as well as with a promise (`statSync`, `readAsStringSync`,
`writeAsStringSync`, `deleteSync` and the rest), so a file is synchronous where expo-file-system's
is on iOS and Android: `exists` and `size` are read when asked, `create()`, `write()` and
`delete()` are done when they return and throw their failure, `textSync()` reads at once, and
`text()` and `bytes()` answer a promise.

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

A library with a `codegenConfig` gets its specs' codegen, as on Android: the `<Name>JSI.h` its C++
TurboModule implements, and for its Fabric components their props, events and shadow nodes, which
the host compiles in and registers, so the component lays out and its events reach JavaScript. The
library draws it with a subclass of `NGNView` from the host's `component-view.h`, registered for
the component's name as it loads:

```objc
#import "component-view.h"
#include <react/renderer/components/MyLibSpec/Props.h>

@interface MyBadgeView : NGNView
@end

@implementation MyBadgeView
+ (void)load {
  NGNRegisterComponentView(@"MyBadge", self);
}
- (void)updateProps:(const facebook::react::Props::Shared &)props {
  [super updateProps:props]; // background, border, opacity and accessibility
  auto badge = std::dynamic_pointer_cast<const facebook::react::MyBadgeProps>(props);
  // ...
}
@end
```

Events go out through the codegen's `EventEmitter`, cast from `self.eventEmitter`. A component
with no view registered mounts as a plain view, and the host's own components keep theirs.

## Prebuilt hosts

An app with no native desktop code of its own compiles nothing: `run` and `package` download the
prebuilt host its React Native version has in `prebuilt.json`, the universal Release build each
release publishes with its `hermesc` and Sparkle, and unpack it into the per-user cache under its
hash. The archive's SHA-256 is in `prebuilt.json`, inside the npm package, and a download that does
not match it is deleted and stops the command. The host is built from source instead when the app
links a library's or its own native desktop code, when a host library it has installed
(`react-native-screens`, `react-native-safe-area-context`, `react-native-svg`) is another version
than the prebuilt one or denied, when the download fails (with a warning), and when
`NGN_DESKTOP_FROM_SOURCE=1` is set.

`native/scripts/make-prebuilt.mjs <app> <out>` builds and packs one, signed with
`NGN_SIGN_IDENTITY` or ad hoc, and writes its `prebuilt.json` entry; the release workflow runs it
and uploads the archive with the GitHub release.

## Package the app

`ng-native-desktop package [--format app|dmg|mas] [--output <dir>] [--feed-url <url>]
[--sparkle-key <key>] [--skip-notarize]` builds a
universal Release host (arm64 and x86_64, without the core tests, dead code stripped), bundles
with `expo export:embed --platform macos` (the assets laid out as React Native's resolver reads
them beside an embedded bundle), compiles the bundle to Hermes bytecode with the `hermesc` the
host build puts beside its binary, built from the same Hermes, and assembles
`<output>/<name>.app`: the host binary as `Contents/MacOS/<name>` with its local symbols stripped,
the bytecode bundle and assets in `Resources`, the icon compiled by `actool`, and an `Info.plist`
from the Expo keys. Then `app` is
signed ad hoc, `dmg` is signed with the hardened runtime, notarised and stapled (app and disk
image), and `mas` is signed in the App Sandbox and wrapped by `productbuild`. `codesign`,
`notarytool`, `stapler`, `hdiutil`, `ditto`, `sips`, `actool` and `productbuild` are Xcode's.

A `dmg` stops before anything builds when its signing identity or notary credentials are missing,
naming them. `--skip-notarize`, for testing a `dmg` on this Mac only, makes it without them: signed
with `NGN_SIGN_IDENTITY` when that is set and ad hoc when not, with the hardened runtime, and never
sent to Apple. Gatekeeper refuses such a disk image on any other Mac. Sparkle (`--feed-url`) still
needs `NGN_SIGN_IDENTITY` there, since it loads only into an app signed with a Team ID.

`NGN_LOG_COMMITS=1` in the host's environment logs each commit's time to stderr as `[ngn] commit N
ms`, which `pnpm bench:macos` reads. It is off by default, since an animation commits every frame.
`NGN_LOG_ROTORS=1` logs each VoiceOver rotor's items in the first window a second after its first
frame, for checking them without a screen reader.

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

With `NGNUpdatesURL` set, the host takes Expo Updates (protocol 1) from that server: the launch
asset and each of the update's other assets, every one checked against the manifest's hash. React
Native's resolver finds a bundle's images beside it, through `SourceCode`'s `scriptURL`, so the host
lays an update's assets out as its bundle registers them, from the `registerAsset` calls Metro
writes into a JavaScript bundle. A Hermes bytecode bundle's registrations cannot be read, so its
assets are kept by their key, the file hash, and `NgNativeUpdates.localAssets` maps each key to its
`file:` URL. In a `macos` bundle, `@ng-native/metro` gives React Native's `resolveAssetSource` a
transformer that looks there first, by the file hash of the scale it picks, as `expo-asset` does
with `expo-updates` on iOS and Android.

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
