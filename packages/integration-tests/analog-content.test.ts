/**
 * `@ng-native/analog`'s content: `injectContent`, `injectContentFiles` and the two resources,
 * named and shaped as `@analogjs/content` has them, over a `require.context` of `src/content`
 * whose files Metro made `{ attributes, content, tokens }`. And `.md` pages in `pageRoutes`.
 *
 * Loading a page is tested in the example app's Vitest suite, for the reason `analog.test.ts`
 * gives at its top.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { Injector, runInInjectionContext, signal, type Provider } from '@angular/core';
import { ActivatedRoute, convertToParamMap, type Params, type Routes } from '@angular/router';
import {
  contentFileResource,
  contentFilesResource,
  injectContent,
  injectContentFiles,
  injectMarkdownPage,
  pageRoutes,
  provideContentFiles,
  type ContentContext,
} from '@ng-native/analog';
import { injectMarkdownPage as injectRouterMarkdownPage } from '@ng-native/router';
import { injectService, waitFor } from '@ng-native/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

const require = createRequire(import.meta.url);
const { markdownModule } = require('@ng-native/metro/markdown-module.cjs') as {
  markdownModule(src: string, filename: string): string;
};

/** What Metro's `require.context` module holds for a `.md` file. */
function md(src: string): { default: unknown } {
  const code = markdownModule(src, 'test.md');
  return { default: new Function(code.replace(/^export default /, 'return '))() as unknown };
}

const FILES: Record<string, string> = {
  './first-post.md': '---\ntitle: First post\ndate: 2026-10-01\n---\n# First\n\nHello.\n',
  './second-post.md': '---\ntitle: Second post\nslug: renamed\n---\n## Second\n',
  './no-front-matter.md': '# Just Markdown\n',
  './index.md': '---\ntitle: Home\n---\nThe index.\n',
  './blog/nested.md': '---\ntitle: Nested\n---\n# In a folder\n',
  './guide/index.md': '---\ntitle: Guide\n---\n# Guide\n\n## Setup\n\n## Setup\n',
};

/** A `require.context` over `files`, whose list can change, as Metro's does when a file is added. */
function context(files: Record<string, string>): ContentContext & { files: typeof files } {
  const load = (key: string) => {
    if (!(key in load.files)) throw new Error(`Cannot find module '${key}'`);
    return md(load.files[key]!);
  };
  load.files = { ...files };
  load.keys = () => Object.keys(load.files);
  return load;
}

/** A route whose parameters a test sets. */
function route(params: Params = {}) {
  const paramMap = new BehaviorSubject(convertToParamMap(params));
  return {
    paramMap,
    set: (next: Params) => paramMap.next(convertToParamMap(next)),
    provider: {
      provide: ActivatedRoute,
      useValue: { paramMap, snapshot: { data: {} } },
    } satisfies Provider,
  };
}

function inContext<T>(providers: Provider[], run: () => T): T {
  return runInInjectionContext(Injector.create({ providers }), run);
}

describe('injectContentFiles', () => {
  it('lists every file with its filename, slug and attributes, as Analog does', () => {
    const files = inContext(provideContentFiles(context(FILES)), () => injectContentFiles());
    assert.deepEqual(files, [
      {
        filename: '/src/content/first-post.md',
        slug: 'first-post',
        attributes: { title: 'First post', date: '2026-10-01T00:00:00.000Z' },
      },
      {
        filename: '/src/content/second-post.md',
        slug: 'renamed',
        attributes: { title: 'Second post', slug: 'renamed' },
      },
      { filename: '/src/content/no-front-matter.md', slug: 'no-front-matter', attributes: {} },
      { filename: '/src/content/index.md', slug: '', attributes: { title: 'Home' } },
      { filename: '/src/content/blog/nested.md', slug: 'nested', attributes: { title: 'Nested' } },
      { filename: '/src/content/guide/index.md', slug: '', attributes: { title: 'Guide' } },
    ]);
  });

  it('keeps the files the filter returns true for', () => {
    const files = inContext(provideContentFiles(context(FILES)), () =>
      injectContentFiles<{ title?: string }>((file) => file.filename.includes('/blog/')),
    );
    assert.deepEqual(
      files.map((file) => file.attributes.title),
      ['Nested'],
    );
  });

  it('follows the context as a file is added and removed', () => {
    const content = context({ './a.md': '# A\n' });
    const providers = provideContentFiles(content);
    const slugs = () => inContext(providers, () => injectContentFiles().map((file) => file.slug));
    assert.deepEqual(slugs(), ['a']);
    content.files['./b.md'] = '# B\n';
    assert.deepEqual(slugs(), ['a', 'b']);
    delete content.files['./a.md'];
    assert.deepEqual(slugs(), ['b']);
  });

  it('says how to provide the files when the app has none', () => {
    assert.throws(
      () => inContext([], () => injectContentFiles()),
      /^Error: injectContentFiles\(\) reads the files provideContentFiles was given, and the app has none\. Add provideContentFiles\(require\.context\('\.\.\/content', true, \/\\\.md\$\/\)\)/,
    );
  });

  it('names the files of an import.meta.glob from /src/content, wherever the glob started', () => {
    const glob = {
      '/src/content/a.md': md('# A\n'),
      '../content/blog/b.md': md('# B\n').default,
      './c.md': md('# C\n'),
      '/src/content/notes.txt': 'not Markdown',
    };
    const files = inContext(provideContentFiles(glob), () => injectContentFiles());
    assert.deepEqual(
      files.map((file) => file.filename),
      ['/src/content/a.md', '/src/content/blog/b.md', '/src/content/c.md'],
    );
  });

  it("says what to change when the context is 'lazy', or a file is not Metro's module", () => {
    const lazy = Object.assign(async () => md('# A\n'), { keys: () => ['./a.md'] });
    assert.throws(
      () => inContext(provideContentFiles(lazy), () => injectContentFiles()),
      /\/src\/content\/a\.md loaded as a promise\. .*without 'lazy'/,
    );
    const raw = Object.assign(() => ({ default: '# A raw string\n' }), { keys: () => ['./a.md'] });
    assert.throws(
      () => inContext(provideContentFiles(raw), () => injectContentFiles()),
      /is not the module @ng-native\/metro makes of a \.md file/,
    );
  });
});

describe('injectContent', () => {
  const read = (param: Parameters<typeof injectContent>[0], params: Params, fallback?: string) => {
    const { provider } = route(params);
    return firstValueFrom(
      inContext([...provideContentFiles(context(FILES)), provider], () =>
        injectContent(param, fallback),
      ),
    );
  };

  it("finds the file the route's slug names, with its tokens and headings", async () => {
    const file = await read(undefined, { slug: 'first-post' });
    assert.equal(file.filename, '/src/content/first-post');
    assert.equal(file.slug, 'first-post');
    assert.deepEqual(file.attributes, { title: 'First post', date: '2026-10-01T00:00:00.000Z' });
    assert.equal(file.content, '# First\n\nHello.\n');
    assert.equal(file.tokens?.[0]?.type, 'heading');
    assert.deepEqual(file.toc, [{ id: 'first', level: 1, text: 'First' }]);
  });

  it('finds a file whose slug has a space or an accent, which the route gives decoded', async () => {
    const files = { './café.md': '# Café\n', './post.md': '---\nslug: my post\n---\n# Post\n' };
    const find = (slug: string) => {
      const { provider } = route({ slug });
      return firstValueFrom(
        inContext([...provideContentFiles(context(files)), provider], () => injectContent()),
      );
    };
    assert.equal((await find('café')).content, '# Café\n');
    assert.equal((await find('my post')).content, '# Post\n');
  });

  it('finds a file by its front matter slug rather than its name', async () => {
    assert.equal((await read(undefined, { slug: 'renamed' })).attributes['title'], 'Second post');
    assert.equal((await read(undefined, { slug: 'second-post' })).slug, '');
  });

  it('reads another parameter, a subdirectory, or a file named outright', async () => {
    assert.equal((await read('id', { id: 'first-post' })).attributes['title'], 'First post');
    const nested = await read({ param: 'slug', subdirectory: 'blog' }, { slug: 'nested' });
    assert.equal(nested.filename, '/src/content/blog/nested');
    assert.equal(nested.attributes['title'], 'Nested');
    const named = await read({ customFilename: 'no-front-matter' }, {});
    assert.equal(named.content, '# Just Markdown\n');
    assert.deepEqual(named.attributes, {});
  });

  it("finds a folder's index.md by the folder's name, and numbers repeated heading ids", async () => {
    const guide = await read(undefined, { slug: 'guide' });
    assert.equal(guide.filename, '/src/content/guide/index');
    assert.deepEqual(
      guide.toc?.map((item) => item.id),
      ['guide', 'setup', 'setup-1'],
    );
  });

  it('gives the fallback for a file that is not there, as Analog does', async () => {
    assert.deepEqual(await read(undefined, { slug: 'missing' }, 'Nothing here'), {
      filename: '/src/content/missing',
      attributes: {},
      slug: '',
      content: 'Nothing here',
      toc: [],
    });
  });

  it('gives the fallback with no filename when the route has no slug', async () => {
    assert.deepEqual(await read(undefined, {}), {
      filename: '',
      slug: '',
      attributes: {},
      content: 'No Content Found',
      toc: [],
    });
  });

  it('follows the route to the next slug', async () => {
    const { provider, set } = route({ slug: 'first-post' });
    const titles: unknown[] = [];
    const subscription = inContext([...provideContentFiles(context(FILES)), provider], () =>
      injectContent(),
    ).subscribe((file) => titles.push(file.attributes['title']));
    set({ slug: 'renamed' });
    set({ slug: 'missing' });
    subscription.unsubscribe();
    assert.deepEqual(titles, ['First post', 'Second post', undefined]);
  });
});

describe('the content resources', () => {
  it('loads the list, filtered, and a file by a signal of its slug', async () => {
    const { provider } = route({ slug: 'first-post' });
    const injector = injectService(Injector, {
      providers: [...provideContentFiles(context(FILES)), provider],
    });
    const slug = signal('first-post');
    const { list, file, fromRoute } = runInInjectionContext(injector, () => ({
      list: contentFilesResource((one) => one.slug !== ''),
      file: contentFileResource(slug),
      fromRoute: contentFileResource(),
    }));

    await waitFor(() => assert.equal(list.value()?.length, 4));
    await waitFor(() => assert.equal(file.value()?.attributes['title'], 'First post'));
    await waitFor(() => assert.equal(fromRoute.value()?.slug, 'first-post'));

    slug.set('missing');
    await waitFor(() => assert.equal(file.value()?.content, 'No Content Found'));
  });
});

describe('pageRoutes with Markdown pages', () => {
  class MarkdownPage {}

  const pages = (files: Record<string, unknown>) =>
    Object.assign((key: string) => Promise.resolve(files[key]), { keys: () => Object.keys(files) });

  const shape = (routes: Routes): unknown =>
    routes.map((one) => ({
      path: one.path,
      ...(one.children ? { children: shape(one.children) } : {}),
    }));

  it('routes a .md page at the URL its name gives it, beside the .page.ts pages', () => {
    const routes = pageRoutes(
      pages({
        './index.page.ts': {},
        './about.md': md('# About\n'),
        './docs/setup.md': md('# Setup\n'),
      }),
      { markdownPage: MarkdownPage },
    );
    assert.deepEqual(shape(routes), [
      { path: '' },
      { path: 'about' },
      { path: 'docs', children: [{ path: 'setup' }] },
    ]);
  });

  it('asks for a component to draw a .md page with', () => {
    assert.throws(
      () => pageRoutes(pages({ './about.md': md('# About\n') })),
      /\/src\/app\/pages\/about\.md is a Markdown page, .* pageRoutes\(pages, \{ markdownPage \}\)/,
    );
  });

  it('refuses a .md page and a .page.ts page at the same URL', () => {
    assert.throws(
      () =>
        pageRoutes(pages({ './about.md': md('# About\n'), './about.page.ts': {} }), {
          markdownPage: MarkdownPage,
        }),
      /about\.md and .*about\.page\.ts are the same page/,
    );
  });

  it('leaves pages with no .md file as they were, with no component needed', () => {
    assert.deepEqual(shape(pageRoutes(pages({ './index.page.ts': {} }))), [{ path: '' }]);
  });

  it('says injectMarkdownPage is for a Markdown page when the route is not one', () => {
    const { provider } = route();
    assert.throws(
      () => inContext([provider], () => injectMarkdownPage()),
      /is for the markdownPage component fileRoutes or pageRoutes routes a \.md page to/,
    );
  });

  it("is the router's injectMarkdownPage, so one markdownPage component serves fileRoutes too", () => {
    assert.equal(injectMarkdownPage, injectRouterMarkdownPage);
  });
});
