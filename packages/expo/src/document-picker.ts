/**
 * `DocumentPicker`, bound to `expo-document-picker`: the system's file picker.
 *
 * ```ts
 * private readonly documents = inject(DocumentPicker);
 * const [pdf] = await this.documents.pick({ type: 'application/pdf' });
 * ```
 *
 * The options are the module's own, passed through unchanged. What this adds is the thing every
 * call site otherwise writes: a cancelled picker answers with no files rather than a result to
 * unwrap. The system picker needs no permission, so none is asked for. Without the module
 * installed, `pick()` answers with no files.
 */
import { InjectionToken, Service, inject, type Signal } from '@angular/core';
import { expoModule, presence } from './native.ts';

type Expo = typeof import('expo-document-picker');

/** The module's function this service calls. The real module is one; a test provides a fake. */
export type NativeDocumentPicker = Pick<Expo, 'getDocumentAsync'>;

export type DocumentPickerOptions = import('expo-document-picker').DocumentPickerOptions;
export type PickedDocument = import('expo-document-picker').DocumentPickerAsset;

@Service()
export class DocumentPicker {
  /** Overridden in a test to pick files without a file system. */
  static readonly SOURCE = new InjectionToken<NativeDocumentPicker | null>(
    'angular-native.documentPickerSource',
    {
      factory: () =>
        expoModule('expo-document-picker', () => require('expo-document-picker') as Expo),
    },
  );

  private readonly native = inject(DocumentPicker.SOURCE);

  /** Whether the module is here. False where the service is absent, and every call is inert. */
  readonly available: Signal<boolean> = presence(this.native);

  /**
   * Opens the system picker. `type` is a MIME type or a list of them, `multiple` allows more than
   * one file, and `copyToCacheDirectory` (the default) copies each into the app's cache so other
   * Expo modules can read it. Empty if they cancelled.
   */
  async pick(options?: DocumentPickerOptions): Promise<readonly PickedDocument[]> {
    if (!this.native) return [];
    const result = await this.native.getDocumentAsync(options);
    return result.canceled ? [] : result.assets;
  }
}
