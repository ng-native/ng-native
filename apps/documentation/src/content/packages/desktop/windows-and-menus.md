---
title: Windows, menus and the Dock
summary: How the desktop host maps an app's windows, menu bar, tray icons and Dock menu onto AppKit.
---

# Windows, menus and the Dock

How the desktop host turns an app's windows, menus, tray icons and Dock into AppKit's.

## Windows

The app starts on a surface the host never shows, and every window it opens (`AppWindows`, through
the `NgNativeWindows` module) is an NSWindow with a surface of its own on the one runtime, shown
when its first frame mounts, or once the app hides the splash screen it holds
(`NgNativeSplashScreen`). The close button, Cmd-W, Cmd-Q and a logout ask the app, which closes
the window or answers the quit; the host never closes a window or quits on its own, and closing the
last window leaves the app running. A Dock click with no window open sends `reopen`. A window's
frame autosaves under its key (`main`, a route outlet or a `restoreKey`) in the app's preferences
and comes back there, within its size limits, when a window with that key opens again. A reload
closes the windows with no key and keeps the rest for five seconds for the reloaded app to open
again. An app that renders on its own surface instead gets that surface in a window. Each window
tells the app its size and its backing scale as it shows and whenever either changes, as when it
moves to a display of another density, so its engine keeps its own media query size, pixel ratio
and `--hairline`. In a right-to-left language AppKit mirrors each window's chrome (the window
buttons, the toolbar and its chevrons, the sidebar), and the app's views lay out right to left
whenever `I18nManager.isRTL` says so, `allowRTL` and `forceRTL` included, as on iOS. Text with no
`textAlign` aligns to the layout's leading side whatever its script, so a Hebrew paragraph in a
left-to-right app is on the left, as on iOS.

## The menu bar and navigation

The menu bar is the app's (`<menu-bar>`, through `NgNativeMenus`), drawn as NSApp's main menu
once the app sets it, with the host's Developer menu kept before Help; until then the host's own
default bar shows. An item with a `menuRole` is AppKit's own command (Copy reaches the focused
field) unless the app handles it. An app's `[shortcut]` takes its key press before the menus do,
except that Cmd-Z, X, C, V and A still reach a focused text input. A view's `[contextMenu]` shows
as an NSMenu on a secondary click, and its choice comes back to the view. View > Back and Forward
(Cmd-[ and Cmd-]), mouse buttons 4 and 5, a three-finger swipe and, with "Swipe between pages",
a two-finger sideways swipe that nothing scrolls send `navigate` with the window's surface. A back
swipe over a native stack with a screen below its front one is interactive (`back-swipe.h`): the
front screen follows the fingers with the one below showing, goes back when released past a third
of the width or flicked, and slides home when released early. It is not offered on a screen with
`gestureEnabled: false` or `stackAnimation: 'none'`, and a `fade` screen fades instead. A forward
swipe, or a back one with no screen below (into another sidebar item), goes when it ends. Swipes go
back to the right, and in an app that lays out right to left (`I18nManager.isRTL`) to the left, as
Safari's do.

On Linux the same bar is GTK's. Under KDE Plasma (`XDG_CURRENT_DESKTOP` naming KDE) it is a menu
bar under each window's header bar; everywhere else it is the header bar's main menu, as GNOME's
apps have it. Linux's default bar is File (Close Window on Ctrl+W, Print...), Edit, View (Back,
Forward, Show Sidebar on F9, Full Screen on F11), the app's own menus, then a menu named for the app
with Preferences (shown only when the app handles `settings`), About and Quit (Ctrl+Q). Print... and
Show Sidebar are shown, but do nothing on Linux unless the app gives a `print` or `toggleSidebar`
item a handler. Preferences has Ctrl+comma only when the app's own `settings` item names it, as an
app's item replaces the default one whole.
`mod` is Ctrl. The Super key is the desktop's, so an item on `cmd` or `meta` shows no key and no
press chooses it. A key press goes to the app's `[shortcut]` first, then the back and forward keys
(Alt+Left and Alt+Right, a keyboard's Back and Forward keys, and mouse buttons 8 and 9), then the
menus' keys, and a focused text input keeps Ctrl+Z, X, C, V and A. A press nothing in the window
used then reaches its buttons: Return presses a `default` `<native-button>` and Escape a `cancel`
one, while a focused text input or button keeps Return for itself. A view's `[contextMenu]` shows as
a GTK popover menu at the secondary click.

## The tray and the Dock

Each `<tray-icon>` is an NSStatusItem (`NgNativeTray`): an SF Symbol as a template image or a named
image, a title and a tooltip, with its menu on a click or a press when it has none. The `Dock`
service's menu sits above the Dock menu's own items, and its bounce is
`requestUserAttention`, cancelled by the function it answers. A reload clears the tray icons and
the Dock menu until the reloaded app sets its own. The Dock badge is the count of
`NgNativeNotifications` (see [Notifications](/packages/expo/notifications#on-macos)).
