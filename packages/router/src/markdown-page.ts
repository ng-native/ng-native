/**
 * A `.md` file routed as a page by `fileRoutes`: the file, as Metro made it a module, handed to the
 * component the app gave as `markdownPage` through its route's data.
 *
 * The router does not draw Markdown, and does not import the package that does: the Angular-facing
 * packages do not depend on each other. The app's component draws `tokens` with `<markdown>` from
 * `@ng-native/components/markdown`.
 */
import { inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

/**
 * A token `marked.lexer` made, as `<markdown [tokens]>` takes it. Typed here rather than imported
 * from `marked`, so an app's types never need it.
 */
interface MarkdownToken {
  type: string;
  raw: string;
  [key: string]: any;
}

/** A Markdown page's file, for the component given to `fileRoutes` as `markdownPage`. */
export interface MarkdownPageFile<Attributes extends Record<string, any> = Record<string, any>> {
  /** Its path from the pages folder: `about.md`, `guides/install.md`. */
  readonly filename: string;
  /** Its file name without `.md`; `index.md` is `''`. */
  readonly slug: string;
  /** The front matter. A date in it is its ISO string. */
  readonly attributes: Attributes;
  /** The Markdown after the front matter. */
  readonly content: string;
  /** `content` lexed by `marked`, for `<markdown [tokens]>`. */
  readonly tokens: MarkdownToken[];
}

/**
 * The route data key a Markdown page's file is under. The same key `@ng-native/analog` uses, so a
 * `markdownPage` component reads its file from either.
 */
export const MARKDOWN_PAGE = 'ngNativeMarkdownPage';

/**
 * The file of the Markdown page this component draws, in the component given to `fileRoutes` as
 * `markdownPage`: `{ filename, slug, attributes, content, tokens }`.
 */
export function injectMarkdownPage<
  Attributes extends Record<string, any> = Record<string, any>,
>(): MarkdownPageFile<Attributes> {
  const file = inject(ActivatedRoute).snapshot.data[MARKDOWN_PAGE] as
    MarkdownPageFile<Attributes> | undefined;
  if (!file) {
    throw new Error(
      'injectMarkdownPage() is for the markdownPage component fileRoutes routes a .md page to, ' +
        'and this route is not one.',
    );
  }
  return file;
}

/** A Markdown page's file, from the module Metro made of it, or that module's namespace. */
export function markdownPageFile(filename: string, loaded: unknown): MarkdownPageFile {
  const module = isMarkdownModule(loaded) ? loaded : (loaded as { default?: unknown })?.default;
  if (!isMarkdownModule(module)) {
    throw new Error(
      `${filename} is not the module @ng-native/metro makes of a .md file. Bundle the app with ` +
        "withAngularNative from '@ng-native/metro/config.cjs', and test it with ngNative() from " +
        "'@ng-native/testing/vitest'.",
    );
  }
  const base = filename.split('/').pop()!.replace(/\.md$/, '');
  return {
    filename,
    slug: base === 'index' ? '' : base,
    attributes: module.attributes,
    content: module.content,
    tokens: module.tokens,
  };
}

interface MarkdownModule {
  readonly attributes: Record<string, unknown>;
  readonly content: string;
  readonly tokens: MarkdownToken[];
}

function isMarkdownModule(value: unknown): value is MarkdownModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as MarkdownModule).content === 'string' &&
    Array.isArray((value as MarkdownModule).tokens)
  );
}
