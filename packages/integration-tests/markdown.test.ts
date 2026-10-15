/**
 * `<markdown>`, from `@ng-native/components/markdown`, on a plain app's screen: no router and no
 * Analog. A document becomes paragraphs with nested spans, headings, lists, quotes, code blocks
 * and images, and nothing in it is interpreted: raw HTML is text, and a link or an image is held
 * to the schemes it may use.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { DeepLinks, type DeepLinkSource } from '@ng-native/device';
import { cleanup, fireEvent, render, type FakeFabricNode } from '@ng-native/testing';
import { Lexer, lexer, type Token } from 'marked';
import { MarkdownStream } from '../components/src/markdown-stream.ts';
import { compileFixture } from './compile.ts';

interface Screen {
  source: { set(value: string | undefined): void };
  tokens: { set(value: readonly Token[] | undefined): void };
  classes: { set(value: Record<string, string>): void };
  streaming: { set(value: boolean): void };
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
  mod = await compileFixture('fixtures/markdown.ts');
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

  it('runs the lines the source wrapped it at together, and breaks only at a hard break', async () => {
    const { blocks } = await show(
      'Metro parses its **front matter** and lexes its\n_Markdown_ as it bundles.\n\n' +
        'Two spaces  \nend a line, as does a backslash\\\nhere.\n\n' +
        '- a tight item\n  wrapped once',
    );
    assert.equal(
      textOf(blocks()[0]!),
      'Metro parses its front matter and lexes its Markdown as it bundles.',
    );
    assert.equal(textOf(blocks()[1]!), 'Two spaces\nend a line, as does a backslash\nhere.');
    assert.equal(textOf(blocks()[2]!.children[0]!.children[1]!), 'a tight item wrapped once');
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

  it('decodes every name HTML has, and leaves a name it does not have as written', async () => {
    const { blocks } = await show('&rarr; Caf&eacute; 5&euro; &hearts; &notaname;');
    assert.equal(textOf(blocks()[0]!), '→ Café 5€ ♥ &notaname;');
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

describe('a block that did not change', () => {
  it('keeps its native view when a block is added before it', async () => {
    const { blocks, app, screen } = await show('First\n\nSecond');
    const [first, second] = blocks();
    screen.source.set('# Added\n\nFirst\n\nSecond');
    await app.detectChanges();
    assert.deepEqual(
      blocks().map((node) => textOf(node)),
      ['Added', 'First', 'Second'],
    );
    assert.equal(blocks()[1]!.reactTag, first!.reactTag, 'First is the same view, moved');
    assert.equal(blocks()[2]!.reactTag, second!.reactTag, 'Second is the same view, moved');
  });
});

describe('streaming', () => {
  /** A document on screen with streaming set, fed its chunks one at a time. */
  async function stream(...chunks: string[]) {
    const shown = await show('');
    shown.screen.streaming.set(true);
    let source = '';
    for (const chunk of chunks) {
      source += chunk;
      shown.screen.source.set(source);
      await shown.app.detectChanges();
    }
    const feed = async (chunk: string) => {
      source += chunk;
      shown.screen.source.set(source);
      await shown.app.detectChanges();
    };
    return { ...shown, feed };
  }
  const texts = (nodes: FakeFabricNode[]) => nodes.map((node) => textOf(node));

  it('holds back an unclosed code span until it closes', async () => {
    const { blocks, feed } = await stream('Run ', '`cx5');
    assert.deepEqual(texts(blocks()), ['Run']);
    await feed('81` now');
    const paragraph = blocks()[0]!;
    assert.equal(textOf(paragraph), 'Run cx581 now');
    assert.equal(paragraph.children[1]!.props['fontFamily'], 'Menlo');
  });

  it('holds back unclosed emphasis, and draws the text before it again once it closes', async () => {
    const { blocks, feed } = await stream('Done.\n\nThis is **very imp');
    assert.deepEqual(texts(blocks()), ['Done.', 'This is']);
    await feed('ortant** to');
    const paragraph = blocks()[1]!;
    assert.equal(textOf(paragraph), 'This is very important to');
    assert.equal(paragraph.children[1]!.props['fontWeight'], '700');
    await feed(' _kn');
    assert.equal(textOf(blocks()[1]!), 'This is very important to');
    await feed('ow_');
    assert.equal(blocks()[1]!.children.at(-1)!.props['fontStyle'], 'italic');
  });

  it('leaves a lone asterisk, an underscore inside a word and a list bullet alone', async () => {
    const { blocks } = await stream('* one\n* 2 * 3 is snake_case');
    assert.deepEqual(texts(blocks()), ['\u2022one\u20222 * 3 is snake_case']);
  });

  it('holds back a table row until its line ends', async () => {
    const { blocks, feed } = await stream('| a | b |\n');
    assert.equal(blocks().length, 0, 'a header row with no delimiter row yet');
    await feed('|---|---|\n| 1 | 2');
    const table = () => blocks()[0]!;
    const isRow = (node: FakeFabricNode) => node.props['flexDirection'] === 'row';
    const rows = () =>
      flatten([table()]).filter((node) => isRow(node) && !flatten(node.children).some(isRow));
    assert.equal(rows().length, 1, 'the header row alone');
    assert.equal(textOf(table()), 'ab');
    await feed(' |\n');
    assert.equal(rows().length, 2);
    assert.equal(textOf(table()), 'ab12');
  });

  it('holds back a code fence until its opening line ends, then streams the code', async () => {
    const { blocks, named, feed } = await stream('Code:\n\n', '\u0060\u0060\u0060t');
    assert.deepEqual(texts(blocks()), ['Code:']);
    await feed('s\nconst a = 1;\n\u0060\u0060');
    assert.equal(named('ScrollView').length, 1);
    assert.equal(textOf(named('ScrollView')[0]!), 'const a = 1;');
    await feed('\u0060\n\nAfter');
    assert.deepEqual(texts(blocks()), ['Code:', 'const a = 1;', 'After']);
  });

  it('redraws an earlier block a later chunk changes', async () => {
    const { blocks, named, feed } = await stream('See [the docs][d].\n\nMore.\n\n');
    assert.deepEqual(texts(blocks()), ['See [the docs][d].', 'More.']);
    assert.equal(named('VirtualText').length, 0);
    await feed('[d]: https://example.com\n');
    assert.deepEqual(texts(blocks()), ['See the docs.', 'More.']);
    assert.deepEqual(texts(named('VirtualText')), ['the docs'], 'drawn as a link');
  });

  it('turns the last paragraph into a heading when its underline arrives', async () => {
    const { blocks, feed } = await stream('Intro\n\nTitle\n');
    assert.equal(blocks()[1]!.props['accessibilityRole'], undefined);
    await feed('===');
    assert.deepEqual(texts(blocks()), ['Intro', 'Title']);
    assert.equal(blocks()[1]!.props['accessibilityRole'], 'header');
  });

  it('keeps the native views of the blocks before a block that arrives', async () => {
    const { blocks, feed } = await stream('First\n\nSecond');
    const [first, second] = blocks();
    await feed('\n\nThird');
    assert.deepEqual(texts(blocks()), ['First', 'Second', 'Third']);
    assert.equal(blocks()[0]!.reactTag, first!.reactTag, 'First is the same view');
    assert.equal(blocks()[1]!.reactTag, second!.reactTag, 'Second is the same view');
  });

  it('draws a delimiter that cannot open emphasis, before punctuation inside a word', async () => {
    const { blocks } = await stream('Use foo*.bar or foo_.bar now');
    assert.deepEqual(texts(blocks()), ['Use foo*.bar or foo_.bar now']);
  });

  it('holds back a tilde before punctuation that starts a word, which can open', async () => {
    const { blocks } = await stream('See ~/.config');
    assert.deepEqual(texts(blocks()), ['See']);
  });

  it('draws a line after a header row that cannot be a delimiter row', async () => {
    const { blocks, feed } = await stream('| a | b |\n|-');
    assert.equal(blocks().length, 0, 'the start of a delimiter row');
    await feed('x');
    assert.equal(blocks().length, 1);
    assert.match(textOf(blocks()[0]!), /\|-x$/);
    const other = await stream('| a | b |\n|---|\n');
    assert.equal(other.blocks().length, 1, 'a whole second line that did not make a table');
  });

  it('draws a fence line that cannot close the fence it is in', async () => {
    const { named, feed } = await stream('\u0060\u0060\u0060\u0060\ncode\n~~~');
    assert.equal(textOf(named('ScrollView')[0]!), 'code\n~~~', 'a tilde line in a backtick fence');
    await feed('\n\u0060\u0060\u0060');
    assert.equal(textOf(named('ScrollView')[0]!), 'code\n~~~', 'three backticks may yet be four');
    await feed('\u0060\n\nAfter');
    assert.equal(textOf(named('ScrollView')[0]!), 'code\n~~~');
  });

  it('draws a fence line too short to close the fence once a space follows it', async () => {
    const { named } = await stream('\u0060\u0060\u0060\ncode\n\u0060\u0060 ');
    assert.match(textOf(named('ScrollView')[0]!), /^code\n\u0060\u0060/);
  });

  it('converts only the last block again, however many blocks are kept before it', async () => {
    const reads = new Map<string, number>();
    const lex = Lexer.prototype.lex;
    Lexer.prototype.lex = function (this: Lexer, source: string) {
      const tokens = lex.call(this, source);
      for (const token of tokens) {
        if (token.type !== 'paragraph') continue;
        const inline = token.tokens;
        Object.defineProperty(token, 'tokens', {
          get: () => {
            reads.set(token.raw, (reads.get(token.raw) ?? 0) + 1);
            return inline;
          },
        });
      }
      return tokens;
    };
    try {
      const kept = Array.from({ length: 50 }, (_, i) => 'Kept ' + i + '\n\n').join('');
      const { blocks, feed } = await stream(kept, 'Tail');
      reads.clear();
      await feed(' more');
      assert.equal(blocks().length, 51);
      assert.equal(textOf(blocks()[50]!), 'Tail more');
      const settled = [...reads].filter(([raw]) => raw.startsWith('Kept'));
      assert.deepEqual(settled, [], 'no kept paragraph is converted again');
    } finally {
      Lexer.prototype.lex = lex;
    }
  });

  it('holds back a closing fence half written inside a quote', async () => {
    const { named, feed } = await stream('> \u0060\u0060\u0060\n> code\n> \u0060\u0060');
    assert.equal(textOf(named('ScrollView')[0]!), 'code');
    await feed('\u0060\n\nAfter');
    assert.equal(textOf(named('ScrollView')[0]!), 'code');
  });

  it('lexes only the last block again after a quote that defines a link reference', async () => {
    const lexed: string[] = [];
    const lex = Lexer.prototype.lex;
    Lexer.prototype.lex = function (this: Lexer, source: string) {
      lexed.push(source);
      return lex.call(this, source);
    };
    try {
      const { blocks, feed } = await stream('> [d]: https://example.com\n\nSee [d].\n\n', 'One');
      lexed.length = 0;
      await feed('\n\nTwo');
      assert.deepEqual(texts(blocks()), ['', 'See d.', 'One', 'Two']);
      assert.deepEqual(lexed, ['One\n\nTwo']);
    } finally {
      Lexer.prototype.lex = lex;
    }
  });

  it('draws indented code that starts like a fence', async () => {
    const { blocks, named } = await stream('Text\n\n    \u0060\u0060\u0060');
    assert.equal(blocks().length, 2);
    assert.equal(textOf(named('ScrollView')[0]!), '\u0060\u0060\u0060');
  });

  it('draws a finished paragraph when the one after it is held back whole', async () => {
    const { blocks } = await stream('*one\n\n*two');
    assert.deepEqual(texts(blocks()), ['*one']);
    const quoted = await stream('> *one\n>\n> *two');
    assert.deepEqual(texts(quoted.blocks()), ['*one'], 'in a quote');
    const listed = await stream('- a\n\n  *one\n\n  *two');
    assert.deepEqual(texts(listed.blocks()), ['\u2022a*one'], 'in a list item');
  });

  it('holds back an unfinished link or image until it closes', async () => {
    const { blocks, named, feed } = await stream('See [the **docs**](http');
    assert.deepEqual(texts(blocks()), ['See']);
    await feed('s://example.com)');
    assert.deepEqual(texts(blocks()), ['See the docs']);
    assert.deepEqual(texts(named('VirtualText')).slice(0, 1), ['the docs'], 'drawn as a link');
    await feed(' and ![a logo](https://exa');
    assert.deepEqual(texts(blocks()), ['See the docs and']);
    const brackets = await stream('Keep [this] note and [x');
    assert.deepEqual(texts(brackets.blocks()), ['Keep [this] note and']);
  });

  it('holds back a header row with no leading pipe until its delimiter row ends', async () => {
    const { blocks, feed } = await stream('a | b\n--- | -');
    assert.equal(blocks().length, 0, 'a header row and the start of a delimiter row');
    await feed('--\n1 | 2\n');
    assert.equal(textOf(blocks()[0]!), 'ab12');
  });

  it('hides nothing but the end of the last block, streamed a character at a time', () => {
    const documents = [
      '*one\n\n*two\n\n**three**\n',
      'See [the **docs**](https://example.com "Docs") and ![a logo](https://example.com/a.png).\n\n[x] note, `[y` and [z][d].\n\n[d]: https://example.com\n',
      'a | b\n--- | ---\n1 | *2*\n\nAfter `code` and _em_.\n',
      '| a | b |\n|:-|-:|\n| `1` | [2](https://example.com) |\n\nDone ~~gone~~.\n',
      '# Title\n\n- *one*\n- two `x`\n  - nested **b**\n\n> quote *em*\n> more\n\n1. a\n2. [b](c)\n',
      'Text\n\n```ts\nconst a = `b`;\n```\n\n~~~\ncode\n~~~\n\nSetext\n---\n',
    ];
    const json = (tokens: readonly Token[]) => JSON.parse(JSON.stringify(tokens)) as unknown;
    const blocksOf = (tokens: readonly Token[]) => tokens.filter((one) => one.type !== 'space');
    for (const document of documents) {
      const markdown = new MarkdownStream();
      for (let end = 1; end <= document.length; end++) {
        const prefix = document.slice(0, end);
        const whole = blocksOf(lexer(prefix)).map((one) => one.raw);
        const before = whole.slice(0, -1);
        // A character at a time, and the whole prefix in one chunk.
        for (const lexed of [markdown.lex(prefix), new MarkdownStream().lex(prefix)]) {
          const shown = blocksOf(lexed).map((one) => one.raw);
          assert.deepEqual(shown.slice(0, before.length), before, JSON.stringify(prefix));
          assert.ok(shown.length <= whole.length, JSON.stringify(prefix));
          const last = shown[before.length];
          if (last !== undefined) {
            assert.ok(whole.at(-1)!.startsWith(last.trimEnd()), JSON.stringify(prefix));
          }
        }
      }
      assert.deepEqual(json(markdown.lex(document)), json(lexer(document)), document);
    }
  });

  it('draws everything held back once streaming ends', async () => {
    const { blocks, app, screen } = await stream('Run `cx5');
    assert.deepEqual(texts(blocks()), ['Run']);
    screen.streaming.set(false);
    await app.detectChanges();
    assert.deepEqual(texts(blocks()), ['Run `cx5']);
  });
});

describe('tables', () => {
  const TABLE = [
    '| Rank | Pattern | Example context |',
    '| --- | --- | --- |',
    '| 1 | `request completed` | PUT /api/search returned 201 |',
    '| 22 | miss | GET /a |',
  ].join('\n');

  /** The table's cells, row by row, each the text a cell is drawn in. */
  const cellsOf = (table: FakeFabricNode): FakeFabricNode[][] => {
    const isRow = (node: FakeFabricNode) => node.props['flexDirection'] === 'row';
    return flatten([table])
      .filter((node) => isRow(node) && !flatten(node.children).some(isRow))
      .map((row) => flatten(row.children).filter((node) => node.viewName === 'Paragraph'));
  };
  /** The node that holds `node`, found by walking down from `root`. */
  const parentOf = (root: FakeFabricNode, node: FakeFabricNode): FakeFabricNode =>
    flatten([root]).find((one) => one.children.includes(node))!;
  const measure = async (cells: FakeFabricNode[][], widths: number[][]) => {
    for (const [r, row] of cells.entries()) {
      for (const [c, cell] of row.entries()) {
        await fireEvent(cell, 'layout', { layout: { width: widths[r]![c]! } });
      }
    }
  };
  /** Each cell's least width, which lines its column up. */
  const columnWidths = (table: FakeFabricNode) =>
    cellsOf(table).map((row) => row.map((cell) => parentOf(table, cell).props['minWidth']));

  it('scrolls sideways, rather than squeezing its columns into the width of the page', async () => {
    const { blocks } = await show(TABLE);
    const scroll = blocks()[0]!;
    assert.equal(scroll.viewName, 'ScrollView');
    assert.equal(scroll.props['horizontal'], true);
    const cells = cellsOf(scroll);
    assert.deepEqual(
      cells.map((row) => row.map(textOf)),
      [
        ['Rank', 'Pattern', 'Example context'],
        ['1', 'request completed', 'PUT /api/search returned 201'],
        ['22', 'miss', 'GET /a'],
      ],
    );
    for (const node of flatten(scroll.children)) {
      assert.notEqual(node.props['flexGrow'], 1, 'no cell is stretched to share out the page');
      assert.notEqual(node.props['flex'], 1, 'no cell is stretched to share out the page');
    }
    assert.equal(cells[0]![0]!.props['fontWeight'], '600', 'a header cell is bold');
  });

  it('lines each column up at the width of its widest cell', async () => {
    const { blocks } = await show(TABLE);
    await measure(cellsOf(blocks()[0]!), [
      [40, 60, 120],
      [10, 150, 230],
      [20, 30, 50],
    ]);
    assert.deepEqual(columnWidths(blocks()[0]!), [
      [40, 150, 230],
      [40, 150, 230],
      [40, 150, 230],
    ]);
  });

  it('narrows a column again when its widest cell shrinks, or its row goes', async () => {
    const { blocks, app, screen } = await show(TABLE);
    await measure(cellsOf(blocks()[0]!), [
      [40, 60, 120],
      [10, 150, 230],
      [20, 30, 300],
    ]);
    await fireEvent(cellsOf(blocks()[0]!)[1]![1]!, 'layout', { layout: { width: 50 } });
    assert.deepEqual(columnWidths(blocks()[0]!)[0], [40, 60, 300]);

    screen.source.set(TABLE.split('\n').slice(0, 3).join('\n'));
    await app.detectChanges();
    assert.deepEqual(
      columnWidths(blocks()[0]!),
      [
        [40, 60, 230],
        [40, 60, 230],
      ],
      'the row that went no longer counts',
    );
    screen.source.set(['| Rank | Pattern |', '| --- | --- |', '| 1 | a |'].join('\n'));
    await app.detectChanges();
    assert.deepEqual(columnWidths(blocks()[0]!)[0], [40, 60], 'nor does the column that went');
  });

  it('forgets a width when its row or column goes, so one that comes back starts unmeasured', async () => {
    const { blocks, app, screen } = await show(TABLE);
    await measure(cellsOf(blocks()[0]!), [
      [40, 60, 120],
      [10, 150, 230],
      [20, 30, 300],
    ]);
    screen.source.set(['| Rank | Pattern |', '| --- | --- |', '| 1 | a |'].join('\n'));
    await app.detectChanges();
    screen.source.set(TABLE);
    await app.detectChanges();
    assert.deepEqual(
      columnWidths(blocks()[0]!)[0]!.map((width) => width ?? null),
      [40, 150, null],
      'neither the last row nor the last column kept its width while they were gone',
    );
  });

  it('keeps the text in a cell its own width when the app replaces the th and td classes', async () => {
    const { blocks, app, screen } = await show(TABLE);
    screen.classes.set({ th: 'x-th', td: 'x-td' });
    await app.detectChanges();
    const table = blocks()[0]!;
    for (const cell of cellsOf(table).flat()) {
      const wrapper = parentOf(table, cell);
      const hugs =
        cell.props['alignSelf'] === 'flex-start' ||
        (cell.props['alignSelf'] == null && wrapper.props['alignItems'] === 'flex-start');
      assert.ok(hugs, 'the text is not stretched to its column, so it can report a narrower width');
    }
  });

  it('takes each measurement without going over the rest of the table again', async () => {
    const app = await render(mod['MarkdownColumnsScreen'] as Type<unknown>);
    const screen = app.instance as {
      table: { set(value: unknown): void };
      columns: () => {
        measure(row: number, column: number, event: unknown): void;
        width(column: number): number | null;
      };
    };
    const ROWS = 3000;
    screen.table.set({
      kind: 'table',
      header: [[], [], []],
      rows: Array.from({ length: ROWS }, () => [[], [], []]),
    });
    await app.detectChanges();
    const columns = screen.columns();
    const visited = countVisits();
    try {
      for (let row = 0; row <= ROWS; row++) {
        for (let column = 0; column < 3; column++) {
          columns.measure(row, column, { nativeEvent: { layout: { width: (row * 7) % 200 } } });
          columns.width(column);
        }
      }
    } finally {
      visited.restore();
    }
    assert.equal(columns.width(0), 199);
    const measurements = (ROWS + 1) * 3;
    assert.ok(
      visited.count < measurements * 10,
      `${measurements} measurements went over ${visited.count} elements`,
    );
  });
});

/**
 * Counts the elements the array and map methods a measurement could go over the table with visit,
 * so the cost of a measurement is checked by the work it does rather than by the clock.
 */
function countVisits(): { readonly count: number; restore(): void } {
  const state = { count: 0 };
  const patched: [object, PropertyKey, unknown][] = [];
  const patch = (target: object, key: PropertyKey, size: (self: never) => number): void => {
    const original = Reflect.get(target, key) as (...args: unknown[]) => unknown;
    patched.push([target, key, original]);
    Reflect.set(target, key, function (this: never, ...args: unknown[]) {
      state.count += size(this);
      return original.apply(this, args);
    });
  };
  const length = (self: { length: number }): number => self.length;
  const size = (self: { size: number }): number => self.size;
  for (const key of ['reduce', 'map', 'slice', 'forEach', 'filter', Symbol.iterator] as const) {
    patch(Array.prototype, key, length);
  }
  for (const key of ['forEach', 'entries', 'values', 'keys', Symbol.iterator] as const) {
    patch(Map.prototype, key, size);
  }
  return {
    get count() {
      return state.count;
    },
    restore() {
      for (const [target, key, original] of patched.reverse()) Reflect.set(target, key, original);
    },
  };
}
