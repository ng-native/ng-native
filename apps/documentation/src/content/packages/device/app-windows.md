---
title: Windows
summary: Several windows from one app on macOS and iPadOS, guarded closing, and quitting.
---

# Windows

On macOS, and on iPadOS with the scene plugin, an app can have several windows. They are one app:
root services, the Router and change detection are shared, so a change in one window shows in every
other. On iPhone and Android `AppWindows.available()` is `false` and `open` resolves to `null`.

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
quits instead. The main window's root component is made when that window opens, so `mount`'s
`componentRef` throws until then.

The options every window takes are `title`, `width`, `height`, `minWidth`, `minHeight`, `maxWidth`,
`maxHeight`, `resizable`, `titleBar` (`'default'`, `'transparent'` or `'hidden'`), `fullScreen` and
`autosave`. A window's frame is saved and restored on the next launch, under `main`, its route
outlet or its `restoreKey`; `autosave: false` turns that off.

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

## Reference

<!-- api: AppWindows -->

<!-- api: AppLifecycle -->
