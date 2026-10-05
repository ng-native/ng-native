/**
 * `<markdown>`, from `@ng-native/components/markdown`, on a plain app's screen: no router and no
 * Analog. A document becomes paragraphs with nested spans, headings, lists, quotes, code blocks
 * and images, and nothing in it is interpreted: raw HTML is text, and a link or an image is held
 * to the schemes it may use.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { DeepLinks, type DeepLinkSource } from '@ng-native/device';
import { cleanup, fireEvent, render, type FakeFabricNode } from '@ng-native/testing';
import { lexer, type Token } from 'marked';
import { compileFixture } from './compile.ts';

interface Screen {
  source: { set(value: string | undefined): void };
  tokens: { set(value: readonly Token[] | undefined): void };
  classes: { set(value: Record<string, string>): void };
  presses: { href: string; title: string | null }[];
  prevent: boolean;
}

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);
const textOf = (node: FakeFabricNode): string =>
  flatten([node])
    .filter((one) => one.viewName === 'RawText')
    .map((one) => one.props['text'])
    .join('');

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture(fileURLToPath(new URL('./fixtures/markdown.ts', import.meta.url)));
});
after(cleanup);

async function show(source: string) {
  const opened: string[] = [];
  const links: DeepLinkSource = {
    launchUrl: () => Promise.resolve(null),
    subscribe: () => () => {},
    open: (url) => void opened.push(url),
  };
  const app = await render(mod['MarkdownScreen'] as Type<unknown>, {
    providers: [{ provide: DeepLinks.SOURCE, useValue: links }],
  });
  const screen = app.instance as Screen;
  screen.source.set(source);
  await app.detectChanges();
  const nodes = () => flatten(app.fabric.committed);
  /** The document's own children: the blocks, in order. */
  const blocks = () => app.fabric.committed[0]!.children[0]!.children;
  const named = (viewName: string) => nodes().filter((node) => node.viewName === viewName);
  return { app, screen, opened, nodes, blocks, named };
}

describe('a paragraph', () => {
  it('is one Paragraph, with a nested span for each emphasis, code span and link', async () => {
    const { blocks } = await show('Hello *world*, `code` and [a link](https://example.com).');
    assert.equal(blocks().length, 1);
    const [paragraph] = blocks();
    assert.equal(paragraph!.viewName, 'Paragraph');
    assert.deepEqual(
      paragraph!.children.map((child) => [child.viewName, textOf(child)]),
      [
        ['RawText', 'Hello '],
        ['VirtualText', 'world'],
        ['RawText', ', '],
        ['VirtualText', 'code'],
        ['RawText', ' and '],
        ['VirtualText', 'a link'],
        ['RawText', '.'],
      ],
    );
    assert.equal(paragraph!.children[1]!.props['fontStyle'], 'italic');
    assert.equal(paragraph!.children[3]!.props['fontFamily'], 'Menlo');
  });

  it('nests emphasis inside strong, and strikes through deleted text', async () => {
    const { blocks } = await show('**bold _both_** ~~gone~~');
    const strong = blocks()[0]!.children[0]!;
    assert.equal(strong.viewName, 'VirtualText');
    assert.equal(strong.props['fontWeight'], '700');
    const em = strong.children.find((child) => child.viewName === 'VirtualText')!;
    assert.equal(textOf(em), 'both');
    assert.equal(em.props['fontStyle'], 'italic');
    assert.equal(em.props['fontWeight'], '700', 'the inner span inherits the outer weight');
    const del = blocks()[0]!.children.at(-1)!;
    assert.equal(textOf(del), 'gone');
    assert.equal(del.props['textDecorationLine'], 'line-through');
  });
});

describe('blocks', () => {
  it('draws each heading level in its own size, announced as a header', async () => {
    const { blocks } = await show('# One\n\n## Two\n\n###### Six');
    assert.deepEqual(
      blocks().map((node) => [
        textOf(node),
        node.props['fontSize'],
        node.props['accessibilityRole'],
      ]),
      [
        ['One', 28, 'header'],
        ['Two', 22, 'header'],
        ['Six', 13, 'header'],
      ],
    );
  });

  it('numbers an ordered list from its start, and nests a list inside an item', async () => {
    const { blocks } = await show('3. three\n4. four\n   - inner\n   - [x] done');
    const list = blocks()[0]!;
    assert.equal(list.viewName, 'View');
    const rows = list.children;
    assert.deepEqual(
      rows.map((row) => textOf(row.children[0]!)),
      ['3.', '4.'],
    );
    assert.equal(rows[0]!.props['flexDirection'], 'row');
    const inner = rows[1]!.children[1]!.children[1]!;
    assert.deepEqual(
      inner.children.map((row) => [textOf(row.children[0]!), textOf(row.children[1]!)]),
      [
        ['•', 'inner'],
        ['☑', 'done'],
      ],
    );
  });

  it('puts a code block in a horizontal scroll view, as selectable monospace text', async () => {
    const { blocks } = await show('```ts\n  const a = 1;\n  a < 2 && a;\n```');
    const scroll = blocks()[0]!;
    assert.equal(scroll.viewName, 'ScrollView');
    assert.equal(scroll.props['horizontal'], true);
    const text = flatten([scroll]).find((node) => node.viewName === 'Paragraph')!;
    assert.equal(text.props['selectable'], true);
    assert.equal(text.props['fontFamily'], 'Menlo');
    assert.equal(textOf(text), '  const a = 1;\n  a < 2 && a;', 'the indent survives');
  });

  it('draws a quote as a view with a rule down its side, and a horizontal rule as a view', async () => {
    const { blocks } = await show('> quoted\n\n---');
    const [quote, rule] = blocks();
    assert.equal(quote!.viewName, 'View');
    assert.equal(quote!.props['borderLeftWidth'], 3);
    assert.equal(textOf(quote!), 'quoted');
    assert.equal(rule!.viewName, 'View');
    assert.equal(rule!.props['height'], 1);
  });
});

describe('links', () => {
  it('reports a pressed link and opens an absolute one', async () => {
    const { screen, named, opened } = await show('[docs](https://example.com/a "The docs")');
    const link = named('VirtualText')[0]!;
    assert.equal(link.props['accessibilityRole'], 'link');
    assert.equal(link.props['accessibilityHint'], 'The docs');
    await fireEvent.press(link);
    assert.deepEqual(screen.presses, [{ href: 'https://example.com/a', title: 'The docs' }]);
    assert.deepEqual(opened, ['https://example.com/a']);
  });

  it('opens nothing when the handler prevents it, or when the target is relative', async () => {
    const { screen, named, opened, app } = await show('[in app](https://example.com/b)');
    screen.prevent = true;
    await fireEvent.press(named('VirtualText')[0]!);
    assert.deepEqual(opened, []);

    screen.prevent = false;
    screen.source.set('[settings](/settings)');
    await app.detectChanges();
    await fireEvent.press(named('VirtualText')[0]!);
    assert.deepEqual(screen.presses.at(-1), { href: '/settings', title: null });
    assert.deepEqual(opened, [], 'a relative link is the app to route');
  });

  it('draws a link to a refused scheme as its text, with nothing to press', async () => {
    for (const href of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'java\tscript:alert(1)',
      'javascript&#58;alert(1)',
      'data:text/html,x',
      'vbscript:x',
      'file:///etc/passwd',
    ]) {
      const { blocks, named } = await show(`before [click](<${href}>) after`);
      assert.equal(textOf(blocks()[0]!), 'before click after', href);
      assert.equal(named('VirtualText').length, 0, href);
    }
  });

  it('refuses a scheme behind leading Unicode whitespace, which a trim would strip', async () => {
    for (const href of [
      '&#160;javascript:alert(1)',
      '&nbsp;intent://evil#Intent;end',
      '&#xFEFF;myapp://transfer?to=evil',
      '&#x2028;file:///etc/passwd',
      '&#x3000;sms:123',
    ]) {
      const { blocks, named, opened } = await show(`before [click](${href}) after`);
      assert.equal(textOf(blocks()[0]!), 'before click after', href);
      assert.equal(named('VirtualText').length, 0, href);
      assert.deepEqual(opened, [], href);
    }
  });

  it('follows mailto and tel', async () => {
    const { named, opened } = await show('[mail](mailto:a@b.c) [call](tel:123)');
    for (const link of named('VirtualText')) await fireEvent.press(link);
    assert.deepEqual(opened, ['mailto:a@b.c', 'tel:123']);
  });
});

describe('text as written', () => {
  it('draws raw HTML as its text, block and inline', async () => {
    const { blocks, named } = await show('<script>alert(1)</script>\n\nA <b>bold</b> claim');
    assert.equal(textOf(blocks()[0]!), '<script>alert(1)</script>');
    assert.equal(textOf(blocks()[1]!), 'A <b>bold</b> claim');
    assert.equal(named('VirtualText').length, 0);
  });

  it('decodes the entities marked leaves in text, once', async () => {
    const { blocks } = await show(
      'Fish &amp; chips &quot;now&quot; &#39;ok&#39; &#x263A; &amp;lt;',
    );
    assert.equal(textOf(blocks()[0]!), 'Fish & chips "now" \'ok\' ☺ &lt;');
  });

  it('leaves the entities in a code span as written', async () => {
    const { blocks } = await show('`&amp;`');
    assert.equal(textOf(blocks()[0]!), '&amp;');
  });
});

describe('images', () => {
  it('lifts an image out of its paragraph, labelled by its alt text', async () => {
    const { blocks } = await show('Before ![A cat](https://example.com/cat.png) after');
    assert.deepEqual(
      blocks().map((node) => node.viewName),
      ['Paragraph', 'Image', 'Paragraph'],
    );
    const image = blocks()[1]!;
    assert.equal(image.props['accessibilityLabel'], 'A cat');
    assert.deepEqual(image.props['source'], [{ uri: 'https://example.com/cat.png', scale: 1 }]);
    assert.equal(image.props['height'], 200, 'a fallback height until it loads');
  });

  it('takes its shape from the load event, and forgets it when the image goes', async () => {
    const { blocks, app, screen } = await show('![wide](https://example.com/w.png)');
    await fireEvent(blocks()[0]!, 'load', {
      source: { uri: 'https://example.com/w.png', width: 400, height: 100 },
    });
    assert.equal(blocks()[0]!.props['aspectRatio'], 4);
    assert.equal(blocks()[0]!.props['height'], 'auto');

    screen.source.set('![other](https://example.com/other.png)');
    await app.detectChanges();
    assert.equal(blocks()[0]!.props['height'], 200, 'another image has a shape of its own');
    screen.source.set('![wide](https://example.com/w.png)');
    await app.detectChanges();
    assert.equal(blocks()[0]!.props['height'], 200, 'the ratio went with the image');
  });

  it('loads only http and https, and draws anything else as its alt text', async () => {
    const { blocks, named } = await show(
      '![local](file:///x.png) ![inline](data:image/png;base64,AAAA) ![rel](cat.png)',
    );
    assert.equal(named('Image').length, 0);
    assert.equal(textOf(blocks()[0]!), 'local inline rel');
  });

  it('reads an image scheme after the leading Unicode whitespace a trim strips', async () => {
    const { named } = await show(
      '![x](&#160;file:///x.png) ![y](&#x3000;https://example.com/y.png)',
    );
    assert.deepEqual(
      named('Image').map((image) => image.props['source']),
      [[{ uri: 'https://example.com/y.png', scale: 1 }]],
    );
  });
});

describe('inputs', () => {
  it('re-renders when the source changes, and empties when it is cleared', async () => {
    const { blocks, app, screen } = await show('# First');
    assert.equal(textOf(blocks()[0]!), 'First');
    screen.source.set('Second');
    await app.detectChanges();
    assert.deepEqual(
      blocks().map((node) => [node.viewName, textOf(node)]),
      [['Paragraph', 'Second']],
    );
    screen.source.set(undefined);
    await app.detectChanges();
    assert.equal(blocks().length, 0);
  });

  it('draws tokens lexed already, in place of the source', async () => {
    const { blocks, app, screen } = await show('ignored');
    screen.tokens.set(lexer('## From tokens'));
    await app.detectChanges();
    assert.deepEqual(
      blocks().map((node) => [textOf(node), node.props['accessibilityRole']]),
      [['From tokens', 'header']],
    );
  });

  it('draws a link or an image token with no string href as its text', async () => {
    const { blocks, app, screen } = await show('ignored');
    const words = (text: string) => [{ type: 'text', raw: text, text }];
    screen.tokens.set([
      {
        type: 'paragraph',
        raw: '',
        text: '',
        tokens: [
          {
            type: 'link',
            raw: '',
            href: undefined,
            title: null,
            text: 'docs',
            tokens: words('docs'),
          },
          ...words(' and '),
          { type: 'image', raw: '', href: 42, title: null, text: 'pic' },
        ],
      },
    ] as unknown as Token[]);
    await app.detectChanges();
    assert.equal(textOf(blocks()[0]!), 'docs and pic');
  });

  it('replaces an element default class with the one given', async () => {
    const { blocks, app, screen } = await show('# Plain');
    assert.equal(blocks()[0]!.props['fontSize'], 28);
    screen.classes.set({ h1: 'custom' });
    await app.detectChanges();
    assert.equal(blocks()[0]!.props['fontSize'], null, 'md-h1 no longer applies');
  });
});
