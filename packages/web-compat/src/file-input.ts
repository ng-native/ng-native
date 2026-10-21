import { InjectionToken, type Injector } from '@angular/core';
import type { Engine, EngineNode } from '@ng-native/fabric';

/** A file as the picker answers with it. */
interface PickedFile {
  name: string;
  mimeType?: string;
  size?: number;
  lastModified?: number;
  uri: string;
}

/** `expo-document-picker`, by the one function a file input calls. */
export interface FilePicker {
  getDocumentAsync(options: {
    type: string | string[];
    multiple: boolean;
  }): Promise<{ canceled: boolean; assets: readonly PickedFile[] | null }>;
}

/** The picker a file input opens, where an app or a test provides one: `expo-document-picker`. */
export const FILE_PICKER = new InjectionToken<FilePicker>('angular-native.filePicker');

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
 * `expo-document-picker`, which need not be installed: an app with no file input has no use for
 * it. Imported here, inside the `try`, so Metro takes it for optional and builds an app without
 * it. Through `@ng-native/expo` it would not be: that requires the module outside any `try`.
 */
async function expoPicker(): Promise<FilePicker | undefined> {
  try {
    return (await import('expo-document-picker' as string)) as FilePicker;
  } catch {
    if (!warned) {
      console.warn(
        '[angular-native] a file input was clicked, and there is no file picker to open. ' +
          'Install expo-document-picker.',
      );
    }
    warned = true;
    return undefined;
  }
}

/** The picker of the app that is up on an engine, or none while no app is. */
async function picker(engine: Engine): Promise<FilePicker | undefined> {
  const injector = injectors.get(engine);
  if (!injector) return undefined;
  return injector.get(FILE_PICKER, null) ?? (await expoPicker());
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
  const result = await native?.getDocumentAsync({
    type: typesOf(input.accept),
    multiple: !!input.multiple,
  });
  const picked = result && !result.canceled ? result.assets : undefined;
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
