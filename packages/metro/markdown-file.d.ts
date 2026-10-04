import type { Token } from 'marked';

/**
 * A `.md` file as `withAngularNative`'s transformer makes it a module: its front matter, the
 * Markdown after it, and that Markdown lexed by `marked` as it was bundled.
 *
 * ```ts
 * import type { MarkdownFile } from '@ng-native/metro/markdown-file';
 * import release from './release.md';
 *
 * const notes = release as MarkdownFile<{ title: string; version: string }>;
 * ```
 */
export interface MarkdownFile<Attributes extends object = Readonly<Record<string, unknown>>> {
  /** The front matter, parsed as YAML. A date is its ISO string. Empty with no front matter. */
  readonly attributes: Attributes;
  /** The Markdown after the front matter. */
  readonly content: string;
  /** `content`, lexed by `marked.lexer`, for `<markdown [tokens]>`. */
  readonly tokens: Token[];
}
