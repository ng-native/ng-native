/// <reference path="../metro/markdown.d.ts" />
/**
 * A `.md` file imported in any app, with or without Analog: Metro makes it a module of
 * `{ attributes, content, tokens }`, its front matter parsed and its Markdown lexed as it is
 * bundled, and the test runners import it the same way.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { cleanup, render, type FakeFabricNode } from '@ng-native/testing';
import { lexer, type Token } from 'marked';
import { compileFixture } from './compile.ts';

const require = createRequire(import.meta.url);
const { markdownModule, markdownVersions } = require('@ng-native/metro/markdown-module.cjs') as {
  markdownModule(src: string, filename: string): string;
  markdownVersions(): string;
};

interface MarkdownFile {
  attributes: Record<string, unknown>;
  content: string;
  tokens: Token[];
}

/** The module's default export, as the bundle evaluates it. */
function evaluate(code: string): MarkdownFile {
  const match = /^export default (.*);\n$/s.exec(code);
  assert.ok(match, 'one default export of a literal');
  return JSON.parse(match[1]!) as MarkdownFile;
}

const fileOf = (src: string, filename = '/app/src/content/post.md') =>
  evaluate(markdownModule(src, filename));

after(cleanup);

describe('a .md module', () => {
  it('parses the front matter, keeps the Markdown after it, and lexes it with marked', () => {
    const body = '# Hello\n\nA *post*.\n';
    const file = fileOf(`---\ntitle: Hello\ntags:\n  - one\n  - two\ndraft: false\n---\n${body}`);
    assert.deepEqual(file.attributes, { title: 'Hello', tags: ['one', 'two'], draft: false });
    assert.equal(file.content, body);
    assert.deepEqual(file.tokens, JSON.parse(JSON.stringify(lexer(body))));
  });

  it('gives a file with no front matter empty attributes and all of its Markdown', () => {
    const src = '# No front matter\n\n---\n\nA rule above.\n';
    const file = fileOf(src);
    assert.deepEqual(file.attributes, {});
    assert.equal(file.content, src);
    assert.equal(file.tokens[0]!.type, 'heading');
  });

  it('reads front matter written with Windows line endings', () => {
    const file = fileOf('---\r\ntitle: Windows\r\n---\r\nBody\r\n');
    assert.deepEqual(file.attributes, { title: 'Windows' });
    assert.equal(file.content, 'Body\n');
  });

  it('makes an empty file an empty document', () => {
    assert.deepEqual(fileOf(''), { attributes: {}, content: '', tokens: [] });
  });

  it('gives a front matter date as its ISO string', () => {
    assert.deepEqual(fileOf('---\npublished: 2026-10-04\n---\n').attributes, {
      published: '2026-10-04T00:00:00.000Z',
    });
  });

  it('names the file when its front matter is not valid YAML', () => {
    assert.throws(
      () => markdownModule('---\ntitle: [unclosed\n---\nBody\n', '/app/src/content/broken.md'),
      /^Error: \/app\/src\/content\/broken\.md: the front matter of broken\.md is not valid YAML\./,
    );
  });

  it('refuses front matter that is a list or a single value rather than a mapping', () => {
    assert.throws(
      () => markdownModule('---\n- one\n- two\n---\n', '/app/list.md'),
      /must be a YAML mapping of names to values, such as "title: Hello", not a list/,
    );
    assert.throws(
      () => markdownModule('---\njust text\n---\n', '/app/scalar.md'),
      /not a single value/,
    );
  });

  it('keeps every token as plain data, a reference link resolved to its target', () => {
    const src =
      '# Title\n\nSee [the docs][docs] and ![a logo](https://example.com/a.png).\n\n' +
      '- [x] done\n- [ ] open\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n[docs]: https://example.com\n';
    const { tokens } = fileOf(src);
    assert.deepEqual(tokens, JSON.parse(JSON.stringify(lexer(src))));
    const paragraph = tokens.find((token) => token.type === 'paragraph') as {
      tokens: { type: string; href?: string }[];
    };
    assert.equal(
      paragraph.tokens.find((token) => token.type === 'link')?.href,
      'https://example.com',
    );
  });
});

describe('the Metro transformer', () => {
  const transformerPath = require.resolve('@ng-native/metro/transformer.cjs');
  const markdownPath = require.resolve('@ng-native/metro/markdown-module.cjs');

  it('turns a .md file into the module, through the rest of the chain', () => {
    const transformer = require(transformerPath) as {
      transform(params: object): { ast?: unknown };
    };
    const { default: generate } = require('@babel/generator') as {
      default(ast: unknown): { code: string };
    };
    const result = transformer.transform({
      filename: '/app/src/content/post.md',
      src: '---\ntitle: Through Metro\n---\n# Hi\n',
      options: { dev: true, projectRoot: process.cwd() },
      plugins: [],
    });
    const code = generate(result.ast).code;
    assert.match(code, /Through Metro/);
    assert.match(code, /"type": ?"heading"/);
  });

  it('keys its cache on the marked and front-matter it lexes with', () => {
    const modules = require(markdownPath) as { markdownVersions(): string };
    const installed = markdownVersions();
    assert.match(installed, /^marked@\d+\.\d+\.\d+,front-matter@\d+\.\d+\.\d+$/);

    const keyWith = (versions: () => string): string => {
      const original = modules.markdownVersions;
      modules.markdownVersions = versions;
      delete require.cache[transformerPath];
      try {
        return (require(transformerPath) as { getCacheKey(): string }).getCacheKey();
      } finally {
        modules.markdownVersions = original;
        delete require.cache[transformerPath];
      }
    };
    assert.notEqual(
      keyWith(() => 'marked@0.0.1,front-matter@4.0.2'),
      keyWith(() => installed),
      'a new marked is a new key',
    );
  });

  it("lists md among Metro's source extensions, and takes it from the asset ones", () => {
    const { withAngularNative } = require('@ng-native/metro/config.cjs') as {
      withAngularNative(config: object): {
        resolver: { sourceExts: string[]; assetExts: string[] };
      };
    };
    const config = withAngularNative({
      projectRoot: '/app',
      transformer: {},
      resolver: { sourceExts: ['ts', 'js'], assetExts: ['png', 'md'] },
      serializer: { getPolyfills: () => [] },
    });
    assert.ok(config.resolver.sourceExts.includes('md'));
    assert.deepEqual(config.resolver.assetExts, ['png']);
  });
});

describe('importing a .md file', () => {
  const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...flatten(node.children)]);

  it('gives a test under node --test the module the bundle has', async () => {
    const { default: notes } = await import('./fixtures/release-notes.md');
    assert.deepEqual(notes.attributes, {
      title: 'Release notes',
      version: '0.5.0',
      published: '2026-10-04T00:00:00.000Z',
    });
    assert.equal(notes.tokens[0]!.type, 'heading');
  });

  it('draws the tokens of a .md file a plain app imports', async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/markdown-file.ts', import.meta.url)),
    );
    const app = await render(mod['MarkdownFileScreen'] as Type<unknown>);
    const header = flatten(app.fabric.committed).find(
      (node) => node.props['accessibilityRole'] === 'header',
    );
    assert.ok(header, 'the heading is drawn');
    const text = flatten([header])
      .filter((node) => node.viewName === 'RawText')
      .map((node) => node.props['text'])
      .join('');
    assert.equal(text, 'What changed');
  });
});
