import type { Injector } from '@angular/core';
import type { Engine, EngineNode } from '@ng-native/fabric';

const injectors = new WeakMap<Engine, Injector>();

/** An app is up: its injector is where a file input finds the picker, until it answers to undo it. */
export function pickWith(engine: Engine, injector: Injector): () => void {
  injectors.set(engine, injector);
  return () => void injectors.delete(engine);
}

/** A file input, with the properties a library sets on one before it clicks it. */
type FileInput = EngineNode & { accept?: string; multiple?: boolean; files?: unknown };

export const isFileInput = (node: EngineNode): boolean =>
  node.tag === 'input' && String(node.props['type']).toLowerCase() === 'file';

let warned = false;

/**
 * The picker of `@ng-native/expo`, which is `expo-document-picker`. Neither has to be installed:
 * an app with no file input has no use for them.
 */
async function picker(engine: Engine) {
  try {
    const { DocumentPicker } = await import('@ng-native/expo/document-picker');
    return injectors.get(engine)?.get(DocumentPicker);
  } catch {
    if (!warned) {
      console.warn(
        '[angular-native] a file input was clicked, and there is no file picker to open. ' +
          'Install @ng-native/expo and expo-document-picker.',
      );
    }
    warned = true;
    return undefined;
  }
}

/**
 * The types a picker is asked for. An `accept` lists extensions among them, which the picker has
 * no name for: with none it knows, any file can be picked, and the library checks what comes back.
 */
function typesOf(accept: string | undefined): string | string[] {
  const types = (accept ?? '')
    .split(',')
    .map((type) => type.trim())
    .filter((type) => type.includes('/'));
  return types.length ? types : '*/*';
}

/**
 * Open the system's file picker for a file input, as a click on one does in a browser, and
 * answer with the event it is owed: `change` with `files` set, or `cancel`.
 *
 * ponytail: a file is its name, type, size and `uri`, not a `Blob`: what reads its contents
 * reads them from the `uri`. A `Blob` over the file when a library reads one itself.
 */
export async function pickFiles(input: FileInput, engine: Engine): Promise<'change' | 'cancel'> {
  const native = await picker(engine);
  const picked = await native?.pick({ type: typesOf(input.accept), multiple: !!input.multiple });
  if (!picked?.length) return 'cancel';
  const files = picked.map((file) => ({
    name: file.name,
    type: file.mimeType ?? '',
    size: file.size ?? 0,
    lastModified: file.lastModified,
    uri: file.uri,
  }));
  input.files = Object.assign(files, { item: (at: number) => files[at] ?? null });
  return 'change';
}
