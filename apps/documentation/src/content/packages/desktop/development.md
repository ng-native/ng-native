---
title: Debugging and launch settings
summary: DevTools, the red box, input scripts and the settings a desktop run reads at launch.
---

# Debugging and launch settings

Debugging a dev run, driving it from a script, and the settings a run takes at launch.

## Developer tools

A dev run (a bundle from the dev server) registers with the dev server's inspector proxy, so the
app is a Hermes target in its `/json/list` under its app id and the Mac's name, and React Native
DevTools opens on it from `j` in the Expo CLI or Developer > Open DevTools (Command-Option-I): its
console, sources with source maps, breakpoints and stepping. While the debugger holds the
JavaScript, "Paused in debugger" shows over the top of the app's window with a Resume button. A
packaged app (a Release build) has no debugger. A dev run has one on a host built from source and
on the [prebuilt host](/packages/desktop/packaging#prebuilt-hosts) alike: `run` downloads the debug
host, the dev build with the debugger, and `package` the release one.

JavaScript's errors show in a red box, a window over the app's: fatal ones, the errors
`ErrorUtils` and React Native's error pipeline hand on, and soft ones logged with `console.error`
(Angular's `ErrorHandler` logs every error it catches there). Its stack is symbolicated by the dev
server to the app's sources. Escape or Dismiss closes it, Command-R or Reload reloads the app, Copy
copies the error, and with several errors kept the arrows step between them. A reload clears it.
LogBox draws nothing in an Angular app, so the red box stands in for it. The Developer menu has
Reload and Open DevTools; React Native's element inspector and performance monitor are React
features with no React tree to read here, so the menu leaves them out.

## Input scripts

A dev run plays an input script into its first window when `NGN_INPUT_SCRIPT` names one
(`input-script.h`): presses, drags, moves, trackpad scrolls, magnifies, rotations and keys, as
AppKit events sent through NSApp, which drives these screens without an accessibility grant. A key
goes to the key window (a character, `space`, `tab`, `delete`, `escape` or `return`), and a
character or a space is typed into a focused text field; a `type` step types the rest of its line
there a character at a time, so smart quotes and capitals follow it. A scroll or gesture
goes to the view under its point, wherever the real pointer is, so a web view scrolls and a map
pans and zooms. A `secondary` step is a secondary click. The steps after a `down` go on from a run
loop timer, so a view that tracks the press in a loop of its own (a source list row) gets its `up`
from the event queue: put a `wait` between them. A `choose` step names the item the next menu to
open picks a second after it opens (a picker's, a pop-up button's or a context menu), since a menu
follows the real pointer.

On Linux the GTK host plays a script in a dev run and in a test launch (`NGN_TESTS=1`), which is how
screens-check's Linux mode drives an exported bundle. It plays under X11 only, Xvfb included,
posting each step to the X server through XTest (`libXtst.so.6`), so a step reaches GTK as a
person's input does, native controls included. The pointer steps, `key` and `type` play, with the
command modifier as Ctrl and option as Alt. A character is typed in the keyboard group that has it,
the active group first, and the active group is put back after. A press the script has not
released when it ends or its window closes is released then. A script with `scroll`, `magnify`, `rotate` or `choose`
is refused, as is any script on an X server without the XTEST extension, with the reason in the
host's log.

## Crash reports

macOS keeps a report of each crash in `~/Library/Logs/DiagnosticReports`. On Linux the GTK host
writes its own: on a fatal signal it writes `crash.txt`, naming the signal and the native stack, to
the test launch's state folder, or to `$XDG_STATE_HOME/<app id>/crash.txt` (`~/.local/state` when
XDG_STATE_HOME is unset), prints the same lines to its standard error, and dies of the signal. When
the report takes longer than two seconds, as when another thread holds a lock the stack's unwinder
needs, the host says so on standard error, and in the report once it is open, and dies of the
signal with what it has written.

## Logging

`NGN_LOG_COMMITS=1` in the host's environment logs each commit's time to stderr as `[ngn] commit N
ms`, which `pnpm bench:macos` and `pnpm bench:linux` read. It is off by default, since an
animation commits every frame.
`NGN_LOG_ROTORS=1` logs each VoiceOver rotor's items in the first window a second after its first
frame, for checking them without a screen reader. Both, and `NGN_INPUT_SCRIPT`, work only in a dev
run: a packaged app ignores them, as it ignores the rest of its environment but `NGN_NO_PROMPTS=1`,
which only takes system prompts away (permission requests and sign-in among them).

## Launch settings

A dev run takes its bundle, module, title, app id and capabilities from the command line, and
settings such as the updates URL from `NGN_*` environment variables. A packaged app, whose
`Info.plist` names `NGNBundleFile`, takes all of them from its `Info.plist` and ignores argv and
the `NGN_*` variables but `NGN_NO_PROMPTS`, so nothing that launches the app can make it run
another bundle, as another app, or take updates from another server.

A dev run with `NGN_TESTS=1` is a test launch, which `vitest --project macos` (`@ng-native/testing`)
starts with `NGN_STATE_DIR`, `NGN_RUN_ID` and `NGN_TESTS_FAKE_SYSTEM_UI=1`. Its windows show on
screen without activating the app or taking focus, and it has no Dock icon until a test focuses a
window through `AppWindows`. Its Application Support, Caches and temporary folders are under
`NGN_STATE_DIR`, its preferences are in a defaults suite named by the run id, and its Keychain
services are prefixed `ngn-test-<run id>.`; it removes the suite and its Keychain items as it quits
or gets SIGTERM (unless its main thread is still busy when SIGTERM's wait ends), and those a run
that crashed or ended that way left when the next test launch starts. With
`NGN_TESTS_FAKE_SYSTEM_UI=1` (or `NGN_NO_PROMPTS=1`) no system UI is shown: open and save panels
answer as cancelled, a permission request answers the current status without asking (undetermined
when never asked), Touch ID and sign-in answer as cancelled, and an alert with its cancel button,
or not at all when it has none. A packaged app is never a test launch.

SIGTERM ends any run as a clean quit does, within three seconds: the app is asked to run its
`willQuit` handlers, though not its `canClose` guards, and the host ends once it has answered or
after two seconds, whichever is first. With no app listening it ends at once.
