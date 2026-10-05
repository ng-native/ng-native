/**
 * `@analogjs/content`'s API on native, over the `.md` files in `src/content`: `injectContent`,
 * `injectContentFiles`, `contentFilesResource` and `contentFileResource`, with the names, the
 * arguments and the `ContentFile` shape Analog has, so a blog's pages read the same on both.
 *
 * Analog finds the files with Vite as it builds. On native the app finds them with a
 * `require.context` and hands it to `provideContentFiles`, and Metro has made each file
 * `{ attributes, content, tokens }` already: see `@ng-native/metro`'s `markdown-module.cjs`. So
 * there is no renderer to provide and no parser on the device: a page draws `tokens` with
 * `<markdown>` from `@ng-native/components/markdown`.
 */
import {
  InjectionToken,
  computed,
  inject,
  resource,
  type ResourceRef,
  type Signal,
  type Provider,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { markdownPageFile } from '@ng-native/router';
import { defer, map, of, type Observable } from 'rxjs';

/**
 * A token `marked.lexer` made, as `<markdown [tokens]>` takes it. Typed here rather than imported
 * from `marked`, so an app's types never need it.
 */
export interface ContentToken {
  type: string;
  raw: string;
  [key: string]: any;
}

/** A heading of a content file, as Analog lists them. */
export interface TableOfContentItem {
  /** The heading's text made a slug, as Analog makes it: `Getting started` is `getting-started`. */
  id: string;
  /** 1 for `#`, up to 6. */
  level: number;
  /** The heading as written, without its `#`s. */
  text: string;
}

/** A content file, as `@analogjs/content` gives it, with the tokens it was lexed into. */
export interface ContentFile<Attributes extends Record<string, any> = Record<string, any>> {
  /** Its path from the project, `/src/content/post.md`; without `.md` from `injectContent`. */
  filename: string;
  /** Its front matter `slug`, or its file name without `.md`; `index.md` is `''`. */
  slug: string;
  /** The Markdown after the front matter; the fallback text for a file that is not there. */
  content?: string;
  /** The front matter. A date in it is its ISO string. */
  attributes: Attributes;
  /** `content` lexed by `marked`, for `<markdown [tokens]>`. Not set on the fallback. */
  tokens?: ContentToken[];
  /** The headings, from `injectContent` and `contentFileResource`. */
  toc?: TableOfContentItem[];
}

/** What a `.md` file is as a module, made by `@ng-native/metro` as the app is bundled. */
export interface MarkdownModule {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly content: string;
  readonly tokens: ContentToken[];
}

/**
 * What Metro's `require.context('../content', true, /\.md$/)` returns: the files it found, each
 * keyed by its path from that directory (`./blog/post.md`), and a call that loads one.
 */
export interface ContentContext {
  keys(): string[];
  (key: string): unknown;
}

/**
 * The files of an eager `import.meta.glob`, such as
 * `import.meta.glob('/src/content/**\/*.md', { eager: true })`, for a Vitest test.
 */
export type ContentModules = Readonly<Record<string, unknown>>;

export type InjectContentFilesFilterFunction<T extends Record<string, any>> = (
  value: ContentFile<T>,
  index: number,
  array: ContentFile<T>[],
) => boolean;

/** The parameter `injectContent` and `contentFileResource` find a file by. */
export type ContentParam =
  string | { param: string; subdirectory: string } | { customFilename: string };

/** One file found, by its path from the project and the module Metro made of it. */
interface FoundFile {
  readonly filename: string;
  readonly module: MarkdownModule;
}

const CONTENT_FILES = new InjectionToken<() => FoundFile[]>('@ng-native/analog content files');

/** The content files, or an error saying how to provide them. */
function injectFiles(caller: string): () => FoundFile[] {
  const files = inject(CONTENT_FILES, { optional: true });
  if (!files) {
    throw new Error(
      `${caller} reads the files provideContentFiles was given, and the app has none. Add ` +
        "provideContentFiles(require.context('../content', true, /\\.md$/)) to its providers.",
    );
  }
  return files;
}

const DEFAULT_FALLBACK = 'No Content Found';

/**
 * The content files `injectContent` and `injectContentFiles` read, from a `require.context` of
 * `src/content` in an app:
 *
 * ```ts
 * provideContentFiles(require.context('../content', true, /\.md$/))
 * ```
 *
 * or from an eager `import.meta.glob` of the same files in a Vitest test. The context is read each
 * time a file or the list is asked for, so a file Metro adds or removes is in the next one.
 */
export function provideContentFiles(content: ContentContext | ContentModules): Provider[] {
  return [{ provide: CONTENT_FILES, useValue: () => foundFiles(content) }];
}

function foundFiles(content: ContentContext | ContentModules): FoundFile[] {
  const entries: [string, () => unknown][] =
    typeof content === 'function'
      ? content
          .keys()
          .map((key) => [`/src/content/${key.replace(/^\.\//, '')}`, () => content(key)])
      : Object.keys(content).map((key) => [contentPath(key), () => content[key]]);
  return entries
    .filter(([filename]) => filename.endsWith('.md'))
    .map(([filename, load]) => ({ filename, module: markdownModuleOf(load(), filename) }));
}

/** A glob's key as Analog names a content file, from `/src/content`. */
function contentPath(key: string): string {
  const named = key.replace(/^(?:.*?)\/content(?=\/)/, '/src/content');
  return (
    named.startsWith('/src/content/') ? named : `/src/content/${key.replace(/^\.?\//, '')}`
  ).replace(/\/{2,}/g, '/');
}

/**
 * The `{ attributes, content, tokens }` a loaded `.md` module holds, from its namespace or as it
 * is, checked as `fileRoutes` checks a Markdown page.
 */
function markdownModuleOf(loaded: unknown, filename: string): MarkdownModule {
  if (loaded instanceof Promise || typeof (loaded as { then?: unknown })?.then === 'function') {
    throw new Error(
      `${filename} loaded as a promise. provideContentFiles reads every file as the list is ` +
        "asked for: make its require.context without 'lazy', and an import.meta.glob with " +
        '{ eager: true }.',
    );
  }
  const { attributes, content, tokens } = markdownPageFile(filename, loaded);
  return { attributes, content, tokens };
}

/** A file's slug from its name, as Analog takes it: `post.md` is `post`, `index.md` is `''`. */
function slugOf(filename: string): string {
  const base = (filename.split(/[/\\]/).pop() ?? '').trim().replace(/\.[^./\\]+$/, '');
  return base === 'index' ? '' : base;
}

/** A file's front matter `slug`, or its name's, as written. */
function rawSlugOf(found: FoundFile): string {
  const slug = (found.module.attributes as Record<string, unknown>)['slug'];
  return typeof slug === 'string' && slug ? slug : slugOf(found.filename);
}

/** A file in the list: its slug encoded for a URL, as Analog lists it. */
function listed<Attributes extends Record<string, any>>(found: FoundFile): ContentFile<Attributes> {
  return {
    filename: found.filename,
    attributes: found.module.attributes as Attributes,
    slug: encodeURI(rawSlugOf(found)),
  };
}

/**
 * Where `injectContent` finds each file, as Analog finds it: by its slug, in its own folder, so a
 * front matter `slug` renames the file. A slug with a `/` in it is from the folder under
 * `src/content` it is in, or from `src/content` itself.
 */
function filesBySlug(files: readonly FoundFile[]): Map<string, FoundFile> {
  const bySlug = new Map<string, FoundFile>();
  for (const found of files) {
    const parts = found.filename.split('/');
    const folder = parts.slice(0, -1).join('/');
    const slug = rawSlugOf(found) || 'index';
    const root = parts.length > 4 ? parts.slice(0, 4).join('/') : '/src/content';
    bySlug.set(`${slug.includes('/') ? root : folder}/${slug}.md`.replace(/\/{2,}/g, '/'), found);
  }
  return bySlug;
}

/** The headings of `tokens`, with ids made as Analog makes them. */
function tableOfContents(tokens: readonly ContentToken[]): TableOfContentItem[] {
  const counts = new Map<string, number>();
  const toc: TableOfContentItem[] = [];
  for (const token of tokens) {
    if (token.type !== 'heading') continue;
    const text = String(token['text'] ?? '').trim();
    if (!text) continue;
    const base = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    toc.push({ id: count === 0 ? base : `${base}-${count}`, level: Number(token['depth']), text });
  }
  return toc;
}

/**
 * The file at `/src/content/<prefix><slug>.md`, or `<slug>/index.md` under it, as `injectContent`
 * gives it; the fallback when there is none, as Analog gives it.
 */
function contentFile<Attributes extends Record<string, any>>(
  files: readonly FoundFile[],
  prefix: string,
  slug: string,
  fallback: string,
): ContentFile<Attributes | Record<string, never>> {
  const bySlug = filesBySlug(files);
  const base = `/src/content/${prefix}${slug}`.replace(/\/{2,}/g, '/');
  const key = [`${base}.md`, `${base}/index.md`].find((candidate) => bySlug.has(candidate));
  const found = key === undefined ? undefined : bySlug.get(key);
  if (!key || !found) {
    return { filename: base, attributes: {}, slug: '', content: fallback, toc: [] };
  }
  const { attributes, content, tokens } = found.module;
  return {
    filename: key.replace(/\.md$/, ''),
    slug,
    attributes: attributes as Attributes,
    content,
    tokens,
    toc: tableOfContents(tokens),
  };
}

const NO_SLUG = (fallback: string): ContentFile<Record<string, never>> => ({
  filename: '',
  slug: '',
  attributes: {},
  content: fallback,
  toc: [],
});

/**
 * One content file, by the route parameter that names it, as in Analog:
 *
 * - `injectContent()` reads the `slug` parameter: `/blog/:slug` finds `src/content/<slug>.md`.
 * - `injectContent('id')` reads the `id` parameter instead.
 * - `injectContent({ param: 'slug', subdirectory: 'blog' })` finds `src/content/blog/<slug>.md`.
 * - `injectContent({ customFilename: 'about' })` finds `src/content/about.md`, with no parameter.
 *
 * A file that is not there, or a parameter that is not set, gives `{ attributes: {}, content:
 * fallback }`, which a page can tell by its empty `slug`.
 */
export function injectContent<Attributes extends Record<string, any> = Record<string, any>>(
  param: ContentParam = 'slug',
  fallback = DEFAULT_FALLBACK,
): Observable<ContentFile<Attributes | Record<string, never>>> {
  const files = injectFiles('injectContent()');
  if (typeof param !== 'string' && 'customFilename' in param) {
    return defer(() => of(contentFile<Attributes>(files(), '', param.customFilename, fallback)));
  }
  const prefix = typeof param === 'string' ? '' : `${param.subdirectory}/`;
  const key = typeof param === 'string' ? param : param.param;
  return inject(ActivatedRoute).paramMap.pipe(
    map((params) => params.get(key)),
    map((slug) =>
      slug ? contentFile<Attributes>(files(), prefix, slug, fallback) : NO_SLUG(fallback),
    ),
  );
}

/**
 * Every content file, without its content, as in Analog: `filename`, `slug` and `attributes`, in
 * the order the context lists them. `filterFn` keeps the ones it returns true for.
 */
export function injectContentFiles<Attributes extends Record<string, any>>(
  filterFn?: InjectContentFilesFilterFunction<Attributes>,
): ContentFile<Attributes>[] {
  const files = injectFiles('injectContentFiles()')().map((found) => listed<Attributes>(found));
  return filterFn ? files.filter(filterFn) : files;
}

/** `injectContentFiles`, as a resource, as `@analogjs/content/resources` has it. */
export function contentFilesResource<Attributes extends Record<string, any>>(
  filterFn?: InjectContentFilesFilterFunction<Attributes>,
): ResourceRef<ContentFile<Attributes>[] | undefined> {
  const files = injectContentFiles(filterFn);
  return resource({ loader: async () => files });
}

/**
 * One content file, as a resource, as `@analogjs/content/resources` has it: by `params`, a slug or
 * `{ customFilename }`, or by the route's `slug` parameter when there is none.
 */
export function contentFileResource<Attributes extends Record<string, any> = Record<string, any>>(
  params?: Signal<string | { customFilename: string }>,
  fallback = DEFAULT_FALLBACK,
): ResourceRef<ContentFile<Attributes | Record<string, never>> | undefined> {
  const files = injectFiles('contentFileResource()');
  const input =
    params ??
    toSignal(inject(ActivatedRoute).paramMap.pipe(map((route) => route.get('slug') ?? '')), {
      requireSync: true,
    });
  return resource({
    params: computed(() => ({ input: input() })),
    loader: async ({ params: { input: param } }) => {
      if (typeof param !== 'string') {
        return contentFile<Attributes>(files(), '', param.customFilename, fallback);
      }
      return param ? contentFile<Attributes>(files(), '', param, fallback) : NO_SLUG(fallback);
    },
  });
}
