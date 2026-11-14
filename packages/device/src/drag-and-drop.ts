/**
 * Drag and drop as iPadOS's host takes it, for `(fileDrop)` and `[dragItem]` in
 * `@ng-native/components`. React Native's iOS view keeps no prop it does not know and sends no
 * event it does not know, so on iOS the directives reach a module by the view's `nativeID`, as
 * `[contextMenu]` does. macOS's host reads the `fileDrop` and `dragItem` props instead.
 *
 * The host contract, on the `NgNativeDragAndDrop` module (iOS):
 * - `setFileDrop(nativeID, takes)`: whether the view with `nativeID` takes drops
 *   (UIDropInteraction). iPhone takes none.
 * - `setDragItem(nativeID, item)`: what the view offers when it is dragged out, `{ files, text, url }`
 *   with each file a `file://` url, or null for nothing (UIDragInteraction). iPhone offers none.
 * - Events on `ngNativeDragAndDrop`: `{ type, nativeID, files, text, urls }`, with `type`
 *   `dropEnter`, `dropLeave` or `dropPerform`, in the form the view's `topDropEnter`,
 *   `topDropLeave` and `topDropPerform` carry on macOS.
 * - The host finds the view by its `nativeID` once it is mounted, and lets it go as it unmounts.
 */
import { InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import { reactNative } from './react-native.ts';

/** What a view offers to a drag, as the host takes it. */
export interface NativeDragItem {
  readonly files: readonly string[];
  readonly text: string | null;
  readonly url: string | null;
}

/** A drag over a view, or a drop on it, from the host. */
export interface NativeDropEvent {
  readonly type: 'dropEnter' | 'dropLeave' | 'dropPerform';
  readonly nativeID: string;
  readonly files?: readonly { readonly uri: string; readonly name: string }[];
  readonly text?: string | null;
  readonly urls?: readonly string[];
}

/** The host's drag and drop module. */
export interface NativeDragAndDrop {
  setFileDrop(nativeID: string, takes: boolean): void;
  setDragItem(nativeID: string, item: NativeDragItem | null): void;
  subscribe(listener: (event: NativeDropEvent) => void): () => void;
}

interface DragAndDropModule {
  setFileDrop?(nativeID: string, takes: boolean): void;
  setDragItem?(nativeID: string, item: unknown): void;
}

/**
 * iOS's `NgNativeDragAndDrop` TurboModule, or null where it is not linked, as in Expo Go, and on an
 * iPhone, where it ignores every view: no view is named for it there.
 */
export function dragAndDropSource(): NativeDragAndDrop | null {
  const native = reactNative();
  if (native?.Platform.OS === 'ios' && native.Platform.isPad !== true) return null;
  const module = native?.TurboModuleRegistry?.get?.('NgNativeDragAndDrop') as
    DragAndDropModule | null | undefined;
  if (!module) return null;
  return {
    setFileDrop: (nativeID, takes) => module.setFileDrop?.(nativeID, takes),
    setDragItem: (nativeID, item) => module.setDragItem?.(nativeID, item),
    subscribe: (listener) => {
      const subscription = native?.DeviceEventEmitter?.addListener('ngNativeDragAndDrop', (event) =>
        listener(event as NativeDropEvent),
      );
      return () => subscription?.remove();
    },
  };
}

/**
 * The views that take drops or offer drags by `nativeID`, sent to the host as they change.
 * `(fileDrop)` and `[dragItem]` in `@ng-native/components` register here on iOS; an app rarely
 * injects it.
 */
@Service()
export class DragAndDrop {
  /** Overridden in a test with a fake host. */
  static readonly SOURCE = new InjectionToken<NativeDragAndDrop | null>(
    'angular-native.dragAndDropSource',
    { factory: dragAndDropSource },
  );

  private readonly native = inject(DragAndDrop.SOURCE);

  /** Whether the host has the module, so views take drops and drags by `nativeID`. */
  readonly available: Signal<boolean> = signal(this.native !== null).asReadonly();

  private readonly drops = new Map<string, (event: NativeDropEvent) => void>();

  private readonly unsubscribe =
    this.native?.subscribe((event) => this.drops.get(event.nativeID)?.(event)) ?? null;

  /** Let the view with `nativeID` take drops, each heard by `listener`, or null to stop. */
  setFileDrop(nativeID: string, listener: ((event: NativeDropEvent) => void) | null): void {
    if (listener) this.drops.set(nativeID, listener);
    else this.drops.delete(nativeID);
    this.native?.setFileDrop(nativeID, listener !== null);
  }

  /** What the view with `nativeID` offers when it is dragged out, or null for nothing. */
  setDragItem(nativeID: string, item: NativeDragItem | null): void {
    this.native?.setDragItem(nativeID, item);
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }
}
