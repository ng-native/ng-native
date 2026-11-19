# Linux manual pass

What a person checks on a real Linux desktop that CI cannot: real compositors, Orca, input methods,
portals, fractional scale and the KDE conventions. CI covers the rest, in the AlmaLinux 9 image on
x86_64 and arm64 on every pull request (`host-linux` in `desktop.yml`) and on Ubuntu, Debian and
Fedora every night (`desktop-nightly.yml`).

## When

- **Before each release** that changes `packages/desktop` or the Linux host: the whole list, in both
  sessions below. It is a step of the verify-release skill.
- **On a pull request that touches input, accessibility, portals or window chrome**: a smoke pass,
  the rows marked **smoke**, in the GNOME session, plus the rows of the area the change touches.
  Note the result in the pull request.

A row that was not run says so in the report, with the reason. A row never run on a real session is
not assumed to work: the docs say "not verified on <desktop>" for it.

## The machine

One UTM virtual machine on the Mac: Ubuntu Desktop 26.04 arm64, with GNOME on Wayland (the
default session) and KDE Plasma installed beside it (`sudo apt install kde-plasma-desktop`), chosen
at the login screen. It is the only manual box. Not checked by hand, as an accepted gap: x86_64
interactive behaviour, and real GPU drivers, Vulkan included. UTM's virtual GPU is not a real driver,
so a renderer problem seen only in the VM is noted, not treated as a bug, until it shows elsewhere.

Use the VM on its own: it shares the Mac's cores and memory with simulators and builds, so not beside
two simulators or a native build.

Set up once: Orca (`sudo apt install orca`, Super+Alt+S to toggle it), IBus with a Japanese or
Chinese input method (`ibus-mozc` or `ibus-libpinyin`), and fcitx5 to try in place of IBus. Settings
to switch during the pass: Appearance (light, dark, accent colour), Accessibility (large text, high
contrast, reduce animation, screen reader), Displays (scale 100%, 125%, 200%).

## The build under test

The release candidate, packaged as a person installs it: the `.deb` from
`ng-native-desktop package --os linux --format deb --arch arm64`, for the notes example and for the
canary where it lists `linux`. Install with `sudo apt install ./<name>.deb` and launch from the app
grid, not a terminal, so the desktop file, the icon and the launcher environment are the ones a
person gets.

## Checklist

Each row: what to do, and what passes.

### Launch and windows

| Row              | Do                                                           | Passes when                                                                                                                    | Smoke     |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------- |
| Launch           | Open the app from the grid.                                  | It opens with its icon and name in the dock and the window title; no error in `journalctl --user -b \| grep <app id>`.         | **smoke** |
| Second launch    | Open it again from the grid while it runs.                   | The running window comes forward; no second process (`pgrep -c ngn-linux` is 1).                                               |           |
| Deep link        | `xdg-open <scheme>://<route>` from a terminal.               | The app opens on that route, or the running app moves to it.                                                                   |           |
| Windows          | Open a second window, resize both, close one, then the last. | Each resizes and redraws without tearing; closing the last quits the app.                                                      | **smoke** |
| Window size kept | Resize, quit, open again.                                    | The size is kept; the position is the compositor's (Wayland gives none).                                                       |           |
| Title bar        | Look at the header bar in each title-bar mode the app uses.  | Buttons follow the desktop's layout setting (`gtk-decoration-layout`); a transparent or hidden bar keeps the window draggable. | **smoke** |

### Input

| Row                   | Do                                                                            | Passes when                                                                                     | Smoke     |
| --------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------- |
| Pointer               | Click, double-click, right-click, drag, scroll with the wheel and a touchpad. | Each reaches the view under it; context menus open where clicked.                               | **smoke** |
| Back and forward      | Mouse buttons 8 and 9, and Alt+Left and Alt+Right, on a screen with history.  | They go back and forward.                                                                       |           |
| Keyboard focus        | Tab and Shift+Tab through a form; Ctrl shortcuts from the menus.              | Focus goes in order with a visible ring; each shortcut fires once.                              | **smoke** |
| Input method          | Type in a text input with IBus, then with fcitx5.                             | Preedit shows under the caret, the candidate window sits by it, and commit gives the text once. |           |
| Compose and dead keys | Compose key and a dead-key layout.                                            | The composed character is typed once.                                                           |           |
| Cursors               | Hover text, links, resize handles and a disabled control.                     | Each shows its cursor shape, at the scale's size.                                               |           |

### Accessibility

| Row                   | Do                                                                                           | Passes when                                                                                                             | Smoke     |
| --------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------- |
| Orca, walk            | Turn Orca on and Tab through each screen.                                                    | Each control's role, name and state are spoken; focus follows after a modal opens and closes.                           | **smoke** |
| Orca, announcements   | Trigger an announcement.                                                                     | Spoken on GTK 4.14 and later.                                                                                           |           |
| Orca, structural keys | H, 1 to 6, M, B and F.                                                                       | Known gap: GTK 4 has no AT-SPI Collection, so Orca finds nothing. Confirm the docs still say so; a change here is news. |           |
| Settings follow       | Switch large text, high contrast, reduce animation and the screen reader while the app runs. | The app follows each, live. GNOME's Animations switch does not reach the portal's reduced motion: note it, not a bug.   |           |

### Look and system

| Row                  | Do                                                                                                                | Passes when                                                                                         | Smoke     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------- |
| Dark mode and accent | Switch light and dark, and the accent colour, while the app runs.                                                 | The app follows both, live.                                                                         | **smoke** |
| Fractional scale     | Displays at 125%, then 200%, and drag the window between scales if two displays are set.                          | Text is sharp; borders and frames land on whole pixels with no gaps; popovers sit by their anchors. |           |
| Popovers and dialogs | Open each popover, menu, sheet and dialog.                                                                        | Each opens by its anchor, closes on Escape and outside clicks, and returns focus.                   | **smoke** |
| Portals              | Open and save files, open a URL, send a notification, and anything else the app uses (secrets, location, camera). | Each goes through the desktop's own dialog or service; cancelling is handled.                       | **smoke** |
| Tray and badge       | Where the app shows a tray icon or a dock badge.                                                                  | GNOME shows the tray only with an AppIndicator extension, and ignores the badge: note it.           |           |
| Fonts                | Look at body text, headings and monospace.                                                                        | The desktop's fonts at its default size; `font-mono` is a monospace face.                           |           |

### KDE Plasma

Run the whole list again in the Plasma session, then these rows, which differ there.

| Row                      | Do                                                 | Passes when                                                                              |
| ------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Title bar                | Look at the window frame.                          | KWin draws a server-side title bar for a titled window, with no second GTK bar under it. |
| Menus                    | Open the app's menus.                              | A menu bar where the app has one, as KDE expects, not GNOME's primary menu.              |
| Dialog buttons           | Open a dialog with a confirm and a cancel button.  | The order GTK gives (Cancel, then the action), the same as on GNOME.                     |
| Accent and colour scheme | Change them in System Settings while the app runs. | Followed live, through the portal.                                                       |
| Secrets                  | Save and read a secret the app stores.             | KWallet answers as the Secret Service, after its first-wallet dialog.                    |
| Tray                     | Where the app shows a tray icon.                   | It shows in Plasma's system tray, with its menu.                                         |
| Scroll bars              | Scroll a long list.                                | GTK's overlay scroll bars, which differ from Plasma's own: note, not a bug.              |
| Text size                | Change Plasma's font size.                         | Where it reaches the app, if at all, is recorded in the report.                          |

## Report

For each session: the build tested, each row as passed, failed or not run, with a screenshot
(on GNOME, press Print, choose Window, then capture; Spectacle on Plasma) for each failure, and an issue for each failure that
is not a known gap above.
