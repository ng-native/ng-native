---
title: Drag and drop
summary: Files, text and urls dragged onto a view, and a view dragged out, on macOS and iPadOS.
---

# Drag and drop

Two directives from `@ng-native/components` carry drags between an app and the rest of the system,
on macOS and iPadOS. On iPhone, Android and the web host neither does anything: no event fires and
nothing can be dragged.

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
app. A mouse drag starts it on macOS and a long press on iPadOS.

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

## In a test

`userEvent.dropFiles(node, paths)` drags files onto a view and drops them. See
[Testing on another OS](/packages/testing/testing-other-os).
