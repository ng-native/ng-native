import { DestroyRef, Directive, ElementRef, effect, inject, input, output } from '@angular/core';
import { OS } from '@ng-native/device';
import { HostEngine, type HostNode } from '@ng-native/fabric';

/** A file dragged onto a view: its `file://` url and its name. */
export interface DroppedFile {
  readonly uri: string;
  readonly name: string;
}

/** What is dragged onto a view: files, plain text, and urls that are not files. */
export interface FileDropEvent {
  readonly files: readonly DroppedFile[];
  readonly text: string | null;
  readonly urls: readonly string[];
}

/** What a `[dragItem]` view offers when it is dragged out. Files are paths or `file://` urls. */
export interface DragItemValue {
  readonly files?: readonly string[];
  readonly text?: string;
  readonly url?: string;
}

/** Drag and drop exists on macOS and iPadOS; iPhone's host ignores both props. */
const takesDrags = (os: string): boolean => os === 'macos' || os === 'ios';

/**
 * Files, text and urls dragged onto a view, on macOS and iPadOS: `(fileDragEnter)` as a drag
 * comes over it, `(fileDragLeave)` as it goes off without dropping, and `(fileDrop)` when it is
 * dropped. Each carries a `FileDropEvent`. On iPhone, Android and the web host nothing fires.
 *
 * The host contract: the view takes a `fileDrop` prop of `true`, and sends `topDropEnter`,
 * `topDropLeave` and `topDropPerform` with `{ files, text, urls }`. Those names differ from the
 * outputs', which a binding also listens for, so each output fires once.
 */
@Directive({ selector: '[fileDrop],[fileDragEnter],[fileDragLeave]' })
export class FileDrop {
  readonly fileDragEnter = output<FileDropEvent>();
  readonly fileDragLeave = output<void>();
  readonly fileDrop = output<FileDropEvent>();

  constructor() {
    if (!takesDrags(inject(OS))) return;
    const node = inject(ElementRef).nativeElement as HostNode;
    const engine = inject(HostEngine);
    engine.setProp(node, 'fileDrop', true);
    const stops = [
      engine.setEventListener(node, 'topDropEnter', (event) =>
        this.fileDragEnter.emit(dropOf(event)),
      ),
      engine.setEventListener(node, 'topDropLeave', () => this.fileDragLeave.emit()),
      engine.setEventListener(node, 'topDropPerform', (event) => this.fileDrop.emit(dropOf(event))),
    ];
    inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
  }
}

/**
 * A view that can be dragged out, on macOS and iPadOS: to Finder, another app, or a `(fileDrop)`
 * view. `[dragItem]="{ files: [path] }"`, `{ text }` or `{ url }`, or several of them; null for
 * none. A mouse drag starts it on macOS and a long press on iPadOS.
 *
 * The host contract: the view takes a `dragItem` prop of `{ files, text, url }`, with each file
 * as a `file://` url and the others a string or null, or null to take it away.
 */
@Directive({ selector: '[dragItem]' })
export class DragItem {
  readonly dragItem = input<DragItemValue | null>();

  constructor() {
    if (!takesDrags(inject(OS))) return;
    const node = inject(ElementRef).nativeElement as HostNode;
    const engine = inject(HostEngine);
    effect(() => {
      const item = this.dragItem();
      engine.setProp(node, 'dragItem', item ? committedItem(item) : null);
    });
  }
}

function committedItem(item: DragItemValue) {
  return {
    files: (item.files ?? []).map(fileUrl),
    text: item.text ?? null,
    url: item.url ?? null,
  };
}

/** A path as a `file://` url, and a url as it is. */
function fileUrl(file: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(file)) return file;
  return `file://${file.split('/').map(encodeURIComponent).join('/')}`;
}

function dropOf(event: unknown): FileDropEvent {
  const native = (event as { nativeEvent?: Partial<FileDropEvent> }).nativeEvent ?? {};
  return { files: native.files ?? [], text: native.text ?? null, urls: native.urls ?? [] };
}
