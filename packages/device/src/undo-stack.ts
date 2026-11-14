/**
 * The app's own undo history, kept by the OS's undo manager: NSUndoManager on macOS, UIUndoManager
 * on iOS and iPadOS. Edit > Undo and Edit > Redo, mod+z and mod+shift+z, and iPhone's shake to
 * undo reach the app's actions while no text input has focus; a focused text input keeps its own
 * history. Absent on Android and in the web host, where each call does nothing.
 *
 * The host contract, on the `NgNativeUndo` module: `register(id, label)` registers an action with
 * the one undo manager every window shares, named `label`; undoing it sends `{ type: 'undo', id }`
 * on `ngNativeUndo` and registers its redo under the same id, and redoing sends
 * `{ type: 'redo', id }`. Registering anything else clears the redo history. `undo()`, `redo()`
 * and `clear()` do what Edit > Undo, Edit > Redo and removing every action do. The menu bar's
 * `undo` and `redo` items stay the OS's own, which the undo manager titles and enables.
 */
import { InjectionToken, Service, computed, inject, signal, type Signal } from '@angular/core';
import { reactNative } from './react-native.ts';

/** Something the app has done, and how to take it back and do it again. */
export interface UndoAction {
  /** What Edit > Undo names it: "Undo <label>". */
  readonly label: string;
  undo(): void;
  redo(): void;
}

export type NativeUndoEvent = { readonly type: 'undo' | 'redo'; readonly id: string };

export interface NativeUndo {
  register(id: string, label: string): void;
  undo(): void;
  redo(): void;
  clear(): void;
  subscribe(listener: (event: NativeUndoEvent) => void): () => void;
}

interface UndoTurboModule {
  register?(id: string, label: string): void;
  undo?(): void;
  redo?(): void;
  clear?(): void;
}

function undoSource(): NativeUndo | null {
  const native = reactNative();
  const module = native?.TurboModuleRegistry?.get?.('NgNativeUndo') as
    UndoTurboModule | null | undefined;
  if (!module) return null;
  return {
    register: (id, label) => module.register?.(id, label),
    undo: () => module.undo?.(),
    redo: () => module.redo?.(),
    clear: () => module.clear?.(),
    subscribe: (listener) => {
      const subscription = native?.DeviceEventEmitter?.addListener('ngNativeUndo', (event) =>
        listener(event as NativeUndoEvent),
      );
      return () => subscription?.remove();
    },
  };
}

type Entry = { readonly id: string; readonly action: UndoAction };

@Service()
export class UndoStack {
  /** Overridden in a test with a fake host, such as `fakeUndo()` from `@ng-native/testing`. */
  static readonly SOURCE = new InjectionToken<NativeUndo | null>('angular-native.undoSource', {
    factory: undoSource,
  });

  private readonly native = inject(UndoStack.SOURCE);
  private readonly done = signal<readonly Entry[]>([]);
  private readonly undone = signal<readonly Entry[]>([]);
  private next = 1;
  private readonly unsubscribe = this.native?.subscribe((event) => this.hostSaid(event)) ?? null;

  /** Whether the OS has an undo manager: macOS, iOS and iPadOS. */
  readonly available: Signal<boolean> = signal(this.native !== null).asReadonly();
  readonly canUndo: Signal<boolean> = computed(() => this.done().length > 0);
  readonly canRedo: Signal<boolean> = computed(() => this.undone().length > 0);
  /** The label of the action Edit > Undo takes back, or null. */
  readonly undoLabel: Signal<string | null> = computed(
    () => this.done().at(-1)?.action.label ?? null,
  );
  /** The label of the action Edit > Redo does again, or null. */
  readonly redoLabel: Signal<string | null> = computed(
    () => this.undone().at(-1)?.action.label ?? null,
  );

  /**
   * Record `action`, which the app has just done, so Edit > Undo takes it back. Clears what
   * Edit > Redo had.
   */
  push(action: UndoAction): void {
    if (!this.native) return;
    const entry = { id: String(this.next++), action };
    this.done.update((all) => [...all, entry]);
    this.undone.set([]);
    this.native.register(entry.id, action.label);
  }

  /** Edit > Undo. The action's `undo` runs when the undo manager reaches it. */
  undo(): void {
    this.native?.undo();
  }

  /** Edit > Redo. */
  redo(): void {
    this.native?.redo();
  }

  /** Forget every action, as after the document they changed is closed. */
  clear(): void {
    if (!this.native) return;
    this.done.set([]);
    this.undone.set([]);
    this.native.clear();
  }

  private hostSaid(event: NativeUndoEvent): void {
    const [from, to] = event.type === 'undo' ? [this.done, this.undone] : [this.undone, this.done];
    const entry = from().find((one) => one.id === event.id);
    if (!entry) return;
    from.update((all) => all.filter((one) => one !== entry));
    to.update((all) => [...all, entry]);
    if (event.type === 'undo') entry.action.undo();
    else entry.action.redo();
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }
}
