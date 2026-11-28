/**
 * A box among words, as a library writes a link with an icon in a sentence: `Links would <button
 * tuiLink>inherit</button> in tandem`. A browser sets the box on the line with the words around
 * it, and the words wrap past it. Native draws a view inside a paragraph the same way, as a box
 * on its lines, so a paragraph keeps such a box, and a run of words beside a box among blocks is
 * a paragraph of its own with the box in it.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, signal } from '@angular/core';
import {
  cleanup,
  compileCss,
  render,
  screen,
  settle,
  type FakeFabricNode,
} from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** A link's icon, as Taiga UI draws one: a generated box with a word joiner for its content. */
const SHEET = `
  .link { padding: 0; border: none }
  .link::after { content: '\\2060'; padding: 8px; font-size: 0; line-height: 0; background: red }
  .padded { padding: 4px }
  .block { display: block }
  .spaced { margin: 3px }
  .strut::before { content: '' }
  .row { display: flex }
  .cut { display: inline-block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis }
`;

@Component({
  selector: 'x-sentence',
  template: `
    <p testID="p">
      If you use none, links would
      <button testID="link" class="link" [class.block]="block()"><span>inherit</span></button>
      in tandem.
    </p>
    <div testID="loose">
      Links by default have
      <a testID="anchor" class="link"><span>action</span></a>
      appearance <code>{{ json }}</code
      ><span class="padded">badge</span>
      <p>After</p>
    </div>
    <div testID="toggled">
      Words beside
      @if (shown()) {
        <a class="link"><span>a link</span></a>
      }
      <p>After</p>
    </div>
    <div testID="strut" class="strut">
      Words and <a class="link"><span>a link</span></a>
    </div>
    <p testID="json">
      Value: <code>{{ json }}</code>
    </p>
    <pre testID="pre"><code>{{ json }}</code></pre>
    <p testID="badges"><button class="link">1</button> <button class="link">2</button></p>
    <p testID="spaced">Words <button class="link spaced">spaced</button> after</p>
    <p testID="clipped">Account <span class="cut">1234 4206 9237 8888 4321 0000</span></p>
    <div testID="worded">
      <a class="link"><span>a link</span></a>
      @if (worded()) {
        and words after it
      }
      <p>After</p>
    </div>
    <p testID="last">
      See <a class="link"><span>terms</span></a>
    </p>
    <p testID="joined">
      See<a class="link"><span>terms</span></a>
    </p>
    <div testID="inner">
      Words <code>left <b>right</b></code> <a class="link"><span>a link</span></a>
      <p>After</p>
    </div>
    <div testID="flexed" [class.row]="flexed()">
      Words <code>code</code> <a class="link"><span>a link</span></a>
      <p>After</p>
    </div>
  `,
})
class Sentence {
  readonly block = signal(false);
  readonly shown = signal(true);
  readonly worded = signal(true);
  readonly flexed = signal(false);
  readonly json = JSON.stringify([0], null, 2);
}

afterEach(cleanup);

async function page() {
  const app = await render(Sentence, {
    providers: [provideWebCompat()],
    globalStyles: compileCss(SHEET, 'global', { generated: true } as object) as never,
  });
  await settle();
  return app.instance;
}

const names = (node: FakeFabricNode) => node.children.map((child) => child.viewName);
const words = (node: FakeFabricNode): string =>
  node.children.map((child) => String(child.props['text'] ?? '') + words(child)).join('');
/** The paragraph a run of words beside a box among blocks is: the first view in the block. */
const line = () => screen.getByTestId('loose').children[0]!;

describe('a box among the words of a paragraph', () => {
  it('is a view in the paragraph, on its lines', async () => {
    await page();
    const paragraph = screen.getByTestId('p');
    assert.equal(paragraph.viewName, 'Paragraph');
    assert.deepEqual(names(paragraph), ['RawText', 'View', 'RawText']);
  });

  it('sets its words and its icon on one line of its own, on the baseline of its words', async () => {
    await page();
    const link = screen.getByTestId('link');
    assert.deepEqual([link.props['flexDirection'], link.props['flexWrap']], ['row', 'nowrap']);
    assert.deepEqual(names(link), ['Paragraph', 'View']);
    // Native sits it on the baseline by its bottom edge: it is moved down by the room under its
    // words' baseline, a browser's.
    const [moved] = link.props['transform'] as { translateY: number }[];
    assert.ok(moved!.translateY > 0, JSON.stringify(link.props['transform']));
  });

  it('makes the paragraph a view of blocks once it is a block itself', async () => {
    const sentence = await page();
    sentence.block.set(true);
    await settle();
    assert.equal(screen.getByTestId('p').viewName, 'View');
    sentence.block.set(false);
    await settle();
    assert.equal(screen.getByTestId('p').viewName, 'Paragraph');
  });
});

describe('a paragraph that ends with a box', () => {
  it('keeps the space before the box, which is no space at its end', async () => {
    await page();
    assert.match(words(screen.getByTestId('last')), /^See terms/);
  });

  it('wraps between its words and the box where white space is between them', async () => {
    await page();
    assert.equal(screen.getByTestId('last').props['numberOfLines'], undefined);
  });

  it('is one word on one line where the box is written against its word', async () => {
    await page();
    assert.equal(screen.getByTestId('joined').props['numberOfLines'], 1);
  });
});

describe('a run of words beside a box among blocks', () => {
  it('is a paragraph with the box in it, and spans of the text elements beside it', async () => {
    await page();
    assert.equal(line().viewName, 'Paragraph');
    // A span with padding is a box of its own, as a span of native text can have none.
    assert.deepEqual(names(line()), [
      'VirtualText',
      'View',
      'VirtualText',
      'VirtualText',
      'Paragraph',
    ]);
  });

  it('keeps its spaces beside a box, and a line break written in the template as a space', async () => {
    await page();
    const spans = line().children.filter((child) => child.viewName === 'VirtualText');
    // A span's own line breaks are spaces too: Taiga UI's range example shows a value as JSON.
    assert.deepEqual(spans.map(words), ['Links by default have ', ' appearance ', '[ 0 ]']);
  });

  it("keeps the spaces between a span's own runs", async () => {
    await page();
    assert.match(words(screen.getByTestId('inner').children[0]!), /left right/);
  });

  it('makes its spans paragraphs again once the block lays its children out as a flex box', async () => {
    const sentence = await page();
    assert.deepEqual(names(screen.getByTestId('flexed').children[0]!), [
      'VirtualText',
      'VirtualText',
      'View',
    ]);
    sentence.flexed.set(true);
    await settle();
    // Each child a view of the flex box's, the span no span of any paragraph.
    assert.deepEqual(names(screen.getByTestId('flexed')), [
      'Paragraph',
      'Paragraph',
      'View',
      'Paragraph',
    ]);
  });

  it('lays a link with no display out in a line, its icon beside its words', async () => {
    await page();
    const anchor = screen.getByTestId('anchor');
    assert.deepEqual([anchor.props['flexDirection'], anchor.props['flexWrap']], ['row', 'nowrap']);
  });

  it('is the paragraph it was before once the box has gone', async () => {
    const sentence = await page();
    sentence.shown.set(false);
    await settle();
    // Text alone among blocks is a block of its own, and no span of a line.
    const [words] = screen.getByTestId('toggled').children;
    assert.equal(words!.viewName, 'Paragraph');
    assert.deepEqual(names(words!), ['RawText']);
    sentence.shown.set(true);
    await settle();
    assert.deepEqual(names(screen.getByTestId('toggled').children[0]!), ['VirtualText', 'View']);
  });

  it('is a row of boxes again once its words have gone, its box made again there', async () => {
    const sentence = await page();
    const line = () => screen.getByTestId('worded').children[0]!;
    assert.equal(line().viewName, 'Paragraph');
    sentence.worded.set(false);
    await settle();
    assert.equal(line().viewName, 'View');
    assert.deepEqual(names(line()), ['View']);
    sentence.worded.set(true);
    await settle();
    assert.deepEqual(names(line()), ['View', 'VirtualText']);
  });
});

describe('a span that is an inline-block clipping what it holds', () => {
  it('is a box among the words, its text one line cut short', async () => {
    // Taiga UI's copy example: a long number cut with an ellipsis where the box ends.
    await page();
    const paragraph = screen.getByTestId('clipped');
    assert.equal(paragraph.viewName, 'Paragraph');
    assert.deepEqual(names(paragraph), ['RawText', 'View']);
    const [cut] = paragraph.children[1]!.children;
    assert.equal(cut!.viewName, 'Paragraph');
    assert.deepEqual([cut!.props['numberOfLines'], cut!.props['ellipsizeMode']], [1, 'tail']);
  });
});

describe('boxes a paragraph cannot hold among its words', () => {
  it('are a line of boxes where no words are beside them', async () => {
    // Taiga UI's badges in a paragraph, with only the white space between them.
    await page();
    const badges = screen.getByTestId('badges');
    assert.equal(badges.viewName, 'View');
    assert.deepEqual([badges.props['flexDirection'], badges.props['flexWrap']], ['row', 'wrap']);
  });

  it('are a line of boxes where one has a margin, which native would not keep among words', async () => {
    await page();
    assert.equal(screen.getByTestId('spaced').viewName, 'View');
  });
});

describe('an empty inline box at the start of a line', () => {
  it("puts nothing there, and the space after it goes as a line start's does", async () => {
    // Taiga UI's elastic container: `.t-wrapper::before { content: '' }` before its words.
    await page();
    const texts = (node: FakeFabricNode): string[] => [
      ...(node.props['text'] === undefined ? [] : [String(node.props['text'])]),
      ...node.children.flatMap(texts),
    ];
    assert.match(texts(screen.getByTestId('strut'))[0]!, /^Words/);
  });
});

describe("white space in HTML's text elements", () => {
  it('is a space between words, as a browser collapses it', async () => {
    // Taiga UI's range example shows its value as JSON in a <code>, written over several lines.
    await page();
    assert.equal(words(screen.getByTestId('json')), 'Value: [ 0 ]');
  });

  it('is kept as written in a <pre>, and in a <code> in one, as a browser keeps it', async () => {
    // Taiga UI's time field example shows its value as JSON in a <pre><code>, a line each.
    await page();
    assert.equal(words(screen.getByTestId('pre')), '[\n  0\n]');
  });
});
