---
title: Portals on Linux
summary: The desktop portals the GTK host asks for files, links, notifications and printing.
---

# Portals on Linux

The GTK host asks the desktop, not the app's own process, for what an app has no business reaching
itself: choosing a file, opening a link, showing a notification, printing and holding the screen
awake. It asks through the XDG desktop portals (`org.freedesktop.portal.Desktop` on the session
bus), with one request routine for an app outside a sandbox and for a Flatpak, so a Flatpak needs
no permission for any of them and the code does not change when an app is packaged as one.

A call goes to the portal first. Only when none answers, because there is no session bus or no
`xdg-desktop-portal` running, does it fall back to GTK's own way, which is also what runs from a
Mac in the dev loop. A dialog a portal shows is placed against the app's front window, by its X11 or
Wayland handle.

| Service                              | Portal                                                                                   | Without a portal                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------- |
| `DocumentPicker`                     | FileChooser: `OpenFile` and `SaveFile`                                                   | `GtkFileDialog`                       |
| `Shell`, and `Linking` opening a url | OpenURI: `OpenURI`, `OpenFile` and `OpenDirectory`                                       | GTK's launcher                        |
| Local notifications                  | Notification: `AddNotification` and `RemoveNotification`, and its `ActionInvoked` signal | `GNotification`                       |
| `Printing` a PDF                     | Print: `PreparePrint` and `Print`                                                        | GTK's print dialog                    |
| `Printing` a window or an image      | `GtkPrintOperation`, whose dialog is Print's inside a sandbox                            | GTK's print dialog                    |
| `KeepAwake`                          | Inhibit, for the session being idle                                                      | `GtkApplication`'s own inhibitor      |
| SecureStore, inside a Flatpak        | Secret, through libsecret                                                                | the Secret Service, outside a Flatpak |

`AccessibilityInfo` reads the Settings portal's reduced-motion and contrast, beside GTK's own
settings and AT-SPI's status, and follows them as they change.

A few things follow from a portal being the desktop's:

- **The desktop decides.** A portal's dialog is the desktop's own, so a file chooser looks like the
  other apps' on GNOME and on KDE Plasma. A notification shows only if the desktop's settings allow
  it, and there is no permission to ask for.
- **A closed chooser chooses nothing.** A file chooser the person closes, or a portal request that
  fails, answers `DocumentPicker` as a cancel: no file chosen.
- **A Flatpak's files are the ones the user picks.** The sandbox reaches no other file than those
  the FileChooser portal hands it and the paths `capabilities.paths` declares, which `package`
  turns into `--filesystem` permissions.
- **Secrets are never written to a file.** With no Secret Service running or able to start, there
  is no store and SecureStore is absent.

See [Windows, menus and the tray](/packages/desktop/windows-and-menus) for the tray, which is a
StatusNotifierItem and not a portal, and [Packaging](/packages/desktop/packaging#linux-packages) for
the permissions a Flatpak is built with.
