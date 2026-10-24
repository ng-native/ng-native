import type { Engine, EngineNode } from '@ng-native/fabric';

/** The field `select()` was last called on in each app: what its document's `copy` takes. */
const selected = new WeakMap<Engine, EngineNode>();

/** The part of Expo's clipboard module a copy needs. The module is the app's to install. */
interface NativeClipboard {
  setStringAsync?: (text: string, options: object) => Promise<unknown>;
}

type Field = EngineNode & {
  value?: unknown;
  selectionStart?: unknown;
  selectionEnd?: unknown;
  isConnected?: unknown;
};

/** A field's text has been selected, as a library does before it asks the document to copy it. */
export function select(engine: Engine, field: EngineNode): void {
  selected.set(engine, field);
}

/** The range of the field that is selected, or the whole of it where none is. */
function textToCopy(field: Field): string {
  const text = String(field.value ?? '');
  const { selectionStart: start, selectionEnd: end } = field;
  return typeof start === 'number' && typeof end === 'number' && start < end
    ? text.slice(start, end)
    : text;
}

/**
 * `document.execCommand('copy')`: put the selected field's text on the clipboard, and answer
 * whether there was one to put it on. The clipboard is `expo-clipboard`'s native module, found
 * by name so this package needs none; without it, or without its method, nothing is copied and
 * the library is told so.
 */
export function copySelected(engine: Engine): boolean {
  const field = selected.get(engine) as Field | undefined;
  const modules = (globalThis as { expo?: { modules?: Record<string, NativeClipboard> } }).expo
    ?.modules;
  const write = modules?.['ExpoClipboard']?.setStringAsync;
  // One taken out of the page since, as a screen left behind, is nothing to copy.
  if (!field?.isConnected || typeof write !== 'function') return false;
  // Answered at once, as the command is: a failure after is nothing a library waits to hear.
  try {
    void Promise.resolve(write.call(modules?.['ExpoClipboard'], textToCopy(field), {})).catch(
      () => undefined,
    );
  } catch {
    return false;
  }
  return true;
}
