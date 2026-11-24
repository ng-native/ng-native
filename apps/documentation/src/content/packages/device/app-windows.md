---
title: Windows
summary: Several windows from one app on macOS and iPadOS, guarded closing, and quitting.
---

# Windows

On macOS, and on iPadOS with the config plugin's `ios.multipleWindows` in a development build, an
app can have several windows. They are one app:
root services, the Router and change detection are shared, so a change in one window shows in every
other. On iPhone and Android `AppWindows.available()` is `false` and `open` resolves to `null`.

<!-- platforms: AppWindows -->

## The main window

The root component `mount` is given renders in the main window, which opens at launch, as the app's
one screen does on a phone. Configure it in code:

```ts
import { provideAppLifecycle, provideMainWindow } from '@ng-native/device';

mount(rootTag, App, getFabricUIManager(), {
  providers: [
    provideMainWindow({ width: 900, height: 600, minWidth: 600, titleBar: 'transparent' }),
    provideAppLifecycle({ quitWhenLastWindowCloses: false }),
  ],
});
```

`provideMainWindow({ autoOpen: false })` starts with no window, for an app that lives in the menu
bar; `AppWindows.openMain()` opens it later. On macOS the app keeps running when its last window
closes, and a click on its Dock icon opens the main window again. `quitWhenLastWindowCloses: true`
quits instead. On Linux the app quits with its last window unless `quitWhenLastWindowCloses: false`
keeps it, and launching it again opens the main window. The main window's root component is made
when that window opens, so `mount`'s `componentRef` throws until then.

The options every window takes are `title`, `width`, `height`, `minWidth`, `minHeight`, `maxWidth`,
`maxHeight`, `resizable`, `titleBar` (`'default'`, `'transparent'` or `'hidden'`), `fullScreen` and
`autosave`. A window's frame is saved and restored on the next launch, under `main`, its route
outlet or its `restoreKey`; `autosave: false` turns that off. On Linux only the size comes back,
maximised or full screen when the window was, and never a place: the desktop places each window.

On macOS and Linux, a resizable main window opens at its saved size when there is one. Use a new
`restoreKey` when changing the defaults should give the window a fresh frame, for example
`provideMainWindow({ width: 1280, height: 800, restoreKey: 'workspace-v2' })`. Choose a key
distinct from the app's other window keys. The new frame is saved under that key and restored on
later launches. `AppWindows.openMain()` still opens the main window, whose handle has the key
`main`.

On macOS, bundled dev runs and packaged apps keep window frames in the defaults domain named by
their bundle identifier. Inspect it with `defaults read <bundle-id>`. A window frame uses the key
`NgNativeWindowFrame <key>`, and split view geometry is saved by AppKit under
`NSSplitView Subview Frames <autosaveName>`. Older dev runs that launched the bare host put frames
in the `ngn-macos` domain under `<app-id>.NgNativeWindowFrame <key>`.

On Linux the title bar is the window's libadwaita header bar. `'default'` keeps the content below
it; `'transparent'` makes the bar flat and runs the content under it, clear of it by the safe area's
top inset; `'hidden'` does the same and hides the window's title. The window controls stay in
every mode, as on macOS.

A Linux app runs once. Launching it again, from the desktop's launcher, a link to its scheme or a
file it opens, goes to the instance already running: its window comes to the front, and the link
or the file's `file://` URL reaches `DeepLinks`. Installed from a deb, an rpm or a Flatpak, its
desktop entry is D-Bus activatable, so the desktop starts it through the session bus and hands it
what to open the same way.

## Component windows

`open(Component, { inputs })` opens a window rendering a component, as many as are asked for, such
as one per document:

```ts
const windows = inject(AppWindows);
const note = await windows.open(NoteEditor, { inputs: { id: 7 }, title: 'Groceries' });
```

## Route windows

A route window renders a named outlet of the app's Router, so the URL holds it and a deep link
restores it. Use one for a window there is only one of, such as Settings. Asked for again, the open
window comes to the front and navigates.

```ts
// Routes: { path: 'general', outlet: 'settings', loadComponent: () => import('./general') }
await windows.open({ outlet: 'settings', path: 'general', width: 500 });
```

Closing the window empties its outlet. A route window needs `provideNativeRouter()`.

## Closing and quitting

A window's handle, and `CURRENT_WINDOW` inside it, take a `canClose` guard. The close button, Cmd-W
and `close()` ask every guard first, and the window stays when one answers `false`. A window the OS
closes itself, such as an iPadOS scene swiped away, is not asked.

```ts
@Component({ selector: 'app-editor', template: '...' })
export class Editor {
  private readonly window = inject(CURRENT_WINDOW);
  protected readonly dirty = signal(false);

  constructor() {
    const stop = this.window?.canClose(() => !this.dirty());
    inject(DestroyRef).onDestroy(() => stop?.());
  }
}
```

Quitting (Cmd-Q, a logout, an update's relaunch) asks every window's guards, then runs the
`AppLifecycle.willQuit` handlers and waits for them, for at most five seconds in all.

On macOS a SIGTERM to the host (`kill`, or a test pool ending its run) runs the `willQuit`
handlers but asks no `canClose` guard, so an unsaved-changes dialog cannot hold it. The host ends
once the handlers have finished or two seconds after the signal, whichever is first. A SIGTERM
that arrives while a Command-Q waits on a guard takes that quit over: the guard saying no cancels
the Command-Q, and the host still waits for the `willQuit` handlers.

## Windows on iPadOS

Each window on an iPad is a scene of its own, with the app's one runtime behind every scene. Turn
them on in the config plugin of [`@ng-native/metro`](/packages/metro), which tells iPadOS the app
supports several scenes:

```json
// app.json
{
  "expo": {
    "plugins": [["@ng-native/metro", { "ios": { "multipleWindows": true } }]]
  }
}
```

The main window takes the scene the app launched in, and `open` asks iPadOS for a new scene for
each window after it. iPadOS places and sizes every scene itself, so the size options and
`titleBar` are ignored, and `setTitle` names the scene in the app switcher. iPadOS closes a scene
without asking the app, so the `canClose` guards are not asked there, and there is no quitting:
`quit()` does nothing. A window the user makes from the system, with New Window, opens the main
window in it. Where the main window is open already, the main window comes to the front and stays
open, and the window the user made closes.

A reload keeps each window that has a key (the main window, a route window, or a `restoreKey`
window whose component `provideRestorableWindows` names) in its scene, and the reloaded app renders
it there again. A window without a key closes.

After a relaunch, iPadOS restores the app in the scene it had in front and keeps its other scenes,
which it can list as hidden windows. The app opens the same keyed windows again, and each one goes
back to the scene it had: a restored scene shows its own window, and a hidden window shows its own
once the user opens it.

## Reference

<!-- api: AppWindows -->

<!-- api: AppLifecycle -->
