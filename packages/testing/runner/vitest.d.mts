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
  /**
   * The OS this project's tests run as: which platform files an extensionless import resolves
   * (`.macos`, then `.ios`, then `.native` on a Mac), the view names, and what `OS` answers. What
   * `expo.platforms` in `app.json` lists when unset (`['macos']` alone is macOS), else iOS. iOS,
   * Android and macOS projects can sit in one Vitest config. `render(X, { os })` changes the OS for
   * one render, but not which files were resolved.
   */
  os?: 'ios' | 'android' | 'macos' | 'web';
}

/** The extensions each OS resolves ahead of the plain ones, in order. */
export declare const PLATFORM_EXTENSIONS: Readonly<
  Record<'ios' | 'android' | 'macos' | 'web', readonly string[]>
>;

/** What an extensionless import tries, in order, for `os`. */
export declare function extensionsFor(os: 'ios' | 'android' | 'macos' | 'web'): string[];

/** The OS a project's tests run as when its options name none, from `expo.platforms`. */
export declare function defaultOs(root: string): 'ios' | 'android' | 'macos' | 'web';

/** Compile Angular for Vitest: AOT for decorated sources, the linker for partial-compiled packages. */
export declare function ngNative(options?: NgNativeOptions): Plugin;

/**
 * Where a stand-in module is: the source in the repository, the compiled file in the published
 * package. `from` is the runner's own location.
 */
export declare function standIn(name: string, from?: string | URL): string;
