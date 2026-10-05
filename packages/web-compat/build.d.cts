/** What a module's import is resolved as in place of what it wrote, or null for as written. */
export function aliasOf(moduleName: string, importer: string | undefined): string | null;

/**
 * A Metro config that resolves a library's `@ng-icons/core` to the native icons. Wrap the
 * config last, so a resolver another helper set is the one this goes through.
 */
export function withWebCompat<T extends object>(config: T): T;

/** The same for Vitest, as a Vite plugin: `plugins: [ngNative(), webCompat()]`. */
export function webCompat(): {
  name: string;
  enforce: 'pre';
  resolveId(
    this: unknown,
    source: string,
    importer: string | undefined,
    options: object,
  ): Promise<unknown>;
};
