import {
  DestroyRef,
  Directive,
  ElementRef,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { DragAndDrop, OS, type NativeDragItem } from '@ng-native/device';
import { HostEngine, type HostNode } from '@ng-native/fabric';
import { byNativeId } from './native-id.ts';

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

/** Drag and drop exists on macOS, Linux and iPadOS; iPhone's host ignores both props. */
const takesDrags = (os: string): boolean => os === 'macos' || os === 'linux' || os === 'ios';

/** iOS's host module, which takes both by the view's `nativeID`, where the app has it. */
function moduleOnIos(os: string): DragAndDrop | null {
  const module = inject(DragAndDrop);
  return os === 'ios' && module.available() ? module : null;
}

/**
 * Files, text and urls dragged onto a view, on macOS, Linux and iPadOS: `(fileDragEnter)` as a drag
 * comes over it, `(fileDragLeave)` as it goes off without dropping, and `(fileDrop)` when it is
 * dropped. Each carries a `FileDropEvent`. On iPhone, Android and the web host nothing fires.
 *
 * The host contract: the view takes a `fileDrop` prop of `true`, and sends `topDropEnter`,
 * `topDropLeave` and `topDropPerform` with `{ files, text, urls }`. Those names differ from the
 * outputs', which a binding also listens for, so each output fires once. On iOS, where React
 * Native's view reads no such prop, the view goes to `DragAndDrop` by its `nativeID` instead, and
 * the same events come back from its module (iPadOS; a development build, not Expo Go).
 */
@Directive({ selector: '[fileDrop],[fileDragEnter],[fileDragLeave]' })
export class FileDrop {
  readonly fileDragEnter = output<FileDropEvent>();
  readonly fileDragLeave = output<void>();
  readonly fileDrop = output<FileDropEvent>();

  constructor() {
    const os = inject(OS);
    if (!takesDrags(os)) return;
    const node = inject(ElementRef).nativeElement as HostNode;
    const engine = inject(HostEngine);
    engine.setProp(node, 'fileDrop', true);
    const hear = (type: string, native: unknown) => {
      if (type === 'topDropEnter' || type === 'dropEnter') this.fileDragEnter.emit(dropOf(native));
      else if (type === 'topDropLeave' || type === 'dropLeave') this.fileDragLeave.emit();
      else this.fileDrop.emit(dropOf(native));
    };
    const stops = ['topDropEnter', 'topDropLeave', 'topDropPerform'].map((type) =>
      engine.setEventListener(node, type, (event) =>
        hear(type, (event as { nativeEvent?: unknown }).nativeEvent),
      ),
    );
    inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
    const module = moduleOnIos(os);
    if (module) {
      byNativeId(
        engine,
        node,
        (nativeID) => module.setFileDrop(nativeID, (event) => hear(event.type, event)),
        (nativeID) => module.setFileDrop(nativeID, null),
      )();
    }
  }
}

/**
 * A view that can be dragged out, on macOS, Linux and iPadOS: to a file manager, another app, or a
 * `(fileDrop)` view. `[dragItem]="{ files: [path] }"`, `{ text }` or `{ url }`, or several of
 * them; null for none. A mouse drag starts it on macOS and Linux, and a long press on iPadOS.
 *
 * The host contract: the view takes a `dragItem` prop of `{ files, text, url }`, with each file
 * as a `file://` url and the others a string or null, or null to take it away. On iOS the item
 * goes to `DragAndDrop` by the view's `nativeID` too.
 */
@Directive({ selector: '[dragItem]' })
export class DragItem {
  readonly dragItem = input<DragItemValue | null>();

  constructor() {
    const os = inject(OS);
    if (!takesDrags(os)) return;
    const node = inject(ElementRef).nativeElement as HostNode;
    const engine = inject(HostEngine);
    const module = moduleOnIos(os);
    const offered = () => {
      const item = untracked(this.dragItem);
      return item ? committedItem(item) : null;
    };
    const send =
      module &&
      byNativeId(
        engine,
        node,
        (nativeID) => module.setDragItem(nativeID, offered()),
        (nativeID) => module.setDragItem(nativeID, null),
      );
    effect(() => {
      this.dragItem();
      engine.setProp(node, 'dragItem', offered());
      send?.();
    });
  }
}

function committedItem(item: DragItemValue): NativeDragItem {
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

function dropOf(payload: unknown): FileDropEvent {
  const native = (payload ?? {}) as Partial<FileDropEvent>;
  return { files: native.files ?? [], text: native.text ?? null, urls: native.urls ?? [] };
}
