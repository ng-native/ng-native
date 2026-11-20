---
title: Drag and drop
summary: Files, text and urls dragged onto a view, and a view dragged out, on macOS, Linux and iPad.
---

# Drag and drop

Two directives from `@ng-native/components` carry drags between an app and the rest of the system,
on macOS, Linux and iPadOS. On iPhone, Android and the web host neither does anything: no event
fires and nothing can be dragged.

On iPadOS both take the native side of `@ng-native/components`, which a development build has and
Expo Go does not. The view is found by its `nativeID`, and an element without one is given one
(on an iPad only). A view with a `nativeID` is a stacking context, as one with `opacity` below 1
is: a `z-index` inside it orders its children against each other, not against the element's
siblings, so a dropdown inside a drop zone can paint under the element after it.
iPadOS shows nothing of a drag before it is dropped, so there `(fileDragEnter)` carries no files,
text or urls, and a dropped file arrives as a copy in the app's temporary folder.

## Dropping onto a view

Import `FileDrop` and bind any of its three outputs on a view:

```angular-ts
import { Component, signal } from '@angular/core';
import { FileDrop, Text, View, type FileDropEvent } from '@ng-native/components';

@Component({
  selector: 'app-inbox',
  imports: [FileDrop, Text, View],
  template: `
    <view
      class="inbox"
      [class.over]="over()"
      (fileDragEnter)="over.set(true)"
      (fileDragLeave)="over.set(false)"
      (fileDrop)="add($event)"
    >
      <text>Drop files here</text>
    </view>
  `,
})
export class Inbox {
  protected readonly over = signal(false);

  protected add(drop: FileDropEvent): void {
    this.over.set(false);
    for (const file of drop.files) console.log(file.name, file.uri);
  }
}
```

- **`(fileDragEnter)`** - a drag comes over the view.
- **`(fileDragLeave)`** - it goes off the view without dropping.
- **`(fileDrop)`** - it is dropped. A drop is not also followed by `(fileDragLeave)`.

`(fileDragEnter)` and `(fileDrop)` carry a `FileDropEvent`:

- **`files`** - each file as `{ uri, name }`: its `file://` url and its name.
- **`text`** - the plain text dragged, or null.
- **`urls`** - every dragged url that is not a file, such as a link from a browser.

Without the `FileDrop` import the bindings do nothing, since the view never takes drops.

## Dragging a view out

`[dragItem]` makes a view draggable, to Finder, another app, or a `(fileDrop)` view in the same
app. A mouse drag starts it on macOS and Linux, and a long press on iPadOS.

```angular-html
<view [dragItem]="{ files: [note.path] }"
  ><text>{{ note.title }}</text></view
>
<view [dragItem]="{ text: quote(), url: link() }"
  ><text>{{ quote() }}</text></view
>
```

`files` are paths or `file://` urls, and `text` and `url` are strings. Give several and the drop
target takes the one it understands. Null makes the view not draggable.

## On macOS

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

## On Linux

The GTK host behaves as macOS does, with GTK's drag and drop. A drop is read as a file list or as
text, a file's own `file://` URL included; inside a Flatpak, GTK reads a dropped file through the
document portal, so its URL is one the app can open. A drag out offers its files as a file list and
as a URI list, and its text, or else its URL, as text, with the view's look under the pointer. A
drag that carries a URI list and other text as well arrives with its URLs only.

## Opening a file with the app

A file from Open With, a drop on the Dock icon or a double click on one of the app's document types
reaches `Linking` as its `file://` URL: the initial URL when the app is still launching, a `url`
event after that. Links to the app's scheme arrive the same way.

## In a test

`userEvent.dropFiles(node, paths)` drags files onto a view and drops them. See
[Testing on another OS](/packages/testing/testing-other-os).
