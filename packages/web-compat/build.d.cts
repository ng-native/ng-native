/**
 * A Metro config that reads the sheets of the `libraries` it names, and of the app's `sources`, as
 * a browser does, and resolves `@ng-icons/core` to `@ng-native/web-compat/ng-icons`, whose
 * `NgIcon` draws natively. The transformer's cache version changes with both. Wrap the config
 * last, so a resolver another helper set is the one this goes through.
 */
export function withWebCompat<T extends object>(config: T, options: WebCompatOptions): T;

export interface WebCompatOptions {
  /**
   * The npm packages written for a browser, whose sheets are read as one reads them: a flex
   * container a row. A library written for native is left out, and keeps its columns.
   */
  libraries: readonly string[];
  /**
   * The directories of the app's own sources written for a browser: components copied into the
   * app from a library, as Spartan UI's styled layer is. A relative path is from the project.
   */
  sources?: readonly string[];
}

/** The same for Vitest, as a Vite plugin: `plugins: [ngNative(), webCompat({ libraries })]`. */
export function webCompat(options: WebCompatOptions): {
  name: string;
  enforce: 'pre';
  resolveId(
    source: string,
    importer: string | undefined,
    options: object,
  ): Promise<{ id: string } | null>;
};
