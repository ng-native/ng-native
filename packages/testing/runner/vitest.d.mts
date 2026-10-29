import type { Plugin } from 'vitest/config';

export interface NgNativeOptions {
  /**
   * More packages for Vitest to process rather than hand to Node, for an Angular library whose
   * `package.json` does not list `@angular/core`. `@angular/*`, `@ng-native/*`, `@ng-icons/*` and
   * every package that lists `@angular/core` as a dependency or a peer are always included.
   */
  inline?: (string | RegExp)[];
  /**
   * The npm packages whose components' own stylesheets are compiled as the app's are: the same
   * list the Metro preset takes as `libraryStyles`, so a test draws what the app draws.
   */
  libraryStyles?: string[] | false;
  /**
   * Which `Intl` a test runs with. `'hermes'`, the default, has only the constructors Hermes has
   * (`Collator`, `DateTimeFormat` and `NumberFormat`), so code that builds another throws in a test
   * as it does on a device. `'node'` keeps all of Node's, for an app whose tests rely on them.
   */
  intl?: 'hermes' | 'node';
}

/** Compile Angular for Vitest: AOT for decorated sources, the linker for partial-compiled packages. */
export declare function ngNative(options?: NgNativeOptions): Plugin;

/**
 * Where a stand-in module is: the source in the repository, the compiled file in the published
 * package. `from` is the runner's own location.
 */
export declare function standIn(name: string, from?: string | URL): string;
