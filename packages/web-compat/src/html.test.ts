/**
 * Markup in and out: `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `DOMParser` parse as a
 * browser's common cases do, and write back by the HTML fragment serialization algorithm.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, ElementRef, inject, signal } from '@angular/core';
import { cleanup, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({
  selector: 'x-page',
  template: `<div id="page"><button id="made" class="b" title="t" disabled>x</button></div>`,
})
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

const page = async (): Promise<Dom> => {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  return app.fixture.componentInstance.document;
};

/** A `<div>` holding `markup`, and what it reads back as. */
const roundTrip = (document: Dom, markup: string): string => {
  const div = document.createElement('div');
  div.innerHTML = markup;
  return div.innerHTML;
};

describe('innerHTML serialization', () => {
  it('escapes text and attribute values as the algorithm does', async () => {
    const document = await page();
    const div = document.createElement('div');
    div.appendChild(document.createTextNode('a & b < > "q"'));
    div.firstChild.after(document.createElement('span'));
    div.lastChild.setAttribute('title', 'a&b "<>\'');
    assert.equal(
      div.innerHTML,
      'a &amp; b&nbsp;&lt; &gt; "q"<span title="a&amp;b&nbsp;&quot;&lt;&gt;\'"></span>',
    );
  });

  it('writes comments, and leaves no end tag on a void element', async () => {
    const document = await page();
    assert.equal(
      roundTrip(document, 'a<!--x-->b<br><img src="p.png">'),
      'a<!--x-->b<br><img src="p.png">',
    );
    const div = document.createElement('div');
    div.innerHTML = 'a<!--x-->b';
    assert.equal(div.childNodes.length, 3);
    assert.equal(div.childNodes[1].nodeType, 8);
  });

  it('writes the text of a raw text element as it is', async () => {
    const document = await page();
    const markup =
      '<style><&></style><script type="t"><&></script><xmp><&></xmp><iframe><&></iframe>' +
      '<noembed><&></noembed><noframes><&></noframes><noscript><&></noscript>';
    assert.equal(roundTrip(document, markup), markup);
  });

  it("writes an element's attributes in the order they were set, and none of its native props", async () => {
    const document = await page();
    assert.equal(
      roundTrip(
        document,
        '<a href="h" class="c" id="i">l</a><button disabled title="q">x</button>',
      ),
      '<a href="h" class="c" id="i">l</a><button disabled="" title="q">x</button>',
    );
    // A field's default width is none of its attributes, on it or on a copy of it.
    const input = document.createElement('input');
    assert.equal(
      input.getAttributeNames().length + input.cloneNode().getAttributeNames().length,
      0,
    );
    // One a template made: its attributes, and none of what its native view is given.
    const made = document.getElementById('made');
    assert.equal(made.getAttributeNames().sort().join(' '), 'class disabled id title');
  });

  it('writes a drawing with the names SVG writes in capitals', async () => {
    const document = await page();
    const markup =
      '<svg viewBox="0 0 1 1"><clipPath id="c"><rect width="1"></rect></clipPath>' +
      '<path d="M0 0" clip-path="url(#c)"></path></svg>';
    assert.equal(roundTrip(document, markup), markup);
    const div = document.createElement('div');
    div.innerHTML = '<SVG VIEWBOX="0 0 1 1"><CLIPPATH/><a xlink:href="#x"/></SVG>';
    const svg = div.firstChild;
    assert.equal(
      [
        svg.namespaceURI,
        svg.firstChild.localName,
        svg.lastChild.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
      ].join(' '),
      'http://www.w3.org/2000/svg clipPath #x',
    );
    assert.equal(
      div.innerHTML,
      '<svg viewBox="0 0 1 1"><clipPath></clipPath><a xlink:href="#x"></a></svg>',
    );
  });
});

describe('innerHTML parsing', () => {
  it('reads named, numeric and legacy character references', async () => {
    const document = await page();
    const div = document.createElement('div');
    div.innerHTML = '&amp;&#38;&#x26;&copy;&hellip;&nbsp&notit;&#x80;&#0;&bogus;';
    assert.equal(div.textContent, '&&&©… ¬it;€�&bogus;');
    div.innerHTML = '<a href="?a=1&copy=2&amp;b">x</a>';
    assert.equal(div.firstChild.getAttribute('href'), '?a=1&copy=2&b');
  });

  it('closes the elements a browser implies the end of', async () => {
    const document = await page();
    assert.equal(
      roundTrip(document, '<p>a<p>b<div>c</div><ul><li>d<li>e</ul><dl><dt>f<dd>g</dl></p>'),
      '<p>a</p><p>b</p><div>c</div><ul><li>d</li><li>e</li></ul><dl><dt>f</dt><dd>g</dd></dl><p></p>',
    );
    assert.equal(
      roundTrip(document, '<table><tr><td>a<td>b<tr><td>c</table>'),
      '<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>',
    );
  });

  it("drops a line feed straight after a <pre>'s start, and reads a textarea's text", async () => {
    const document = await page();
    assert.equal(roundTrip(document, '<pre>\nx</pre>'), '<pre>x</pre>');
    const div = document.createElement('div');
    div.innerHTML = '<textarea>\n<b>&amp;</b></textarea>';
    assert.equal(div.firstChild.textContent, '<b>&</b>');
  });

  it("parses a <template>'s markup into its content, apart from its children", async () => {
    const document = await page();
    const div = document.createElement('div');
    div.innerHTML = '<template><b>x</b></template>';
    const template = div.firstChild;
    assert.equal(
      [
        template.childNodes.length,
        template.content.nodeType,
        template.content.firstChild.localName,
      ].join(' '),
      '0 11 b',
    );
    assert.equal(div.innerHTML, '<template><b>x</b></template>');
    template.innerHTML = '<i>y</i>';
    assert.equal(template.content.firstChild.localName, 'i');
    assert.equal(template.innerHTML, '<i>y</i>');
  });

  it('reopens misnested formatting as the adoption agency does', async () => {
    const document = await page();
    assert.equal(roundTrip(document, '<b>1<i>2</b>3</i>'), '<b>1<i>2</i></b><i>3</i>');
    assert.equal(
      roundTrip(document, '<a href="x"><div>a</a>b</div>'),
      '<a href="x"></a><div><a href="x">a</a>b</div>',
    );
  });

  it('puts what is out of place in a table before the table', async () => {
    const document = await page();
    assert.equal(
      roundTrip(document, '<table><b>x</b><tr><td>y</td></tr></table>'),
      '<b>x</b><table><tbody><tr><td>y</td></tr></tbody></table>',
    );
  });

  it('reads every named character reference', async () => {
    const document = await page();
    const div = document.createElement('div');
    div.innerHTML = '&CounterClockwiseContourIntegral;&Bopf;&clubsuit;&NotNestedGreaterGreater;';
    assert.equal(div.textContent, '∳\u{1D539}♣⪢̸');
  });

  it('parses an element of raw text as text', async () => {
    const document = await page();
    const script = document.createElement('script');
    script.innerHTML = '<b>&amp;</b>';
    assert.equal(script.childNodes.length + ' ' + script.textContent, '1 <b>&amp;</b>');
  });
});

describe('outerHTML', () => {
  it('reads an element and what it holds, and replaces it with what is written', async () => {
    const document = await page();
    const div = document.createElement('div');
    div.innerHTML = '<span>a</span><i>b</i>';
    assert.equal(div.firstChild.outerHTML, '<span>a</span>');
    div.firstChild.outerHTML = '<b>c</b>d<!--e-->';
    assert.equal(div.innerHTML, '<b>c</b>d<!--e--><i>b</i>');
  });

  it('does nothing to an element in no parent, and throws for the top of a document', async () => {
    const document = await page();
    const span = document.createElement('span');
    span.outerHTML = '<b></b>';
    assert.equal(span.outerHTML, '<span></span>');
    const made = document.implementation.createHTMLDocument('');
    assert.throws(() => (made.documentElement.outerHTML = '<p></p>'), {
      name: 'NoModificationAllowedError',
    });
  });
});

describe('insertAdjacentHTML', () => {
  it('puts what the markup is at each of the four places', async () => {
    const document = await page();
    const div = document.createElement('div');
    div.innerHTML = '<p>x</p>';
    const p = div.firstChild;
    p.insertAdjacentHTML('beforebegin', '<i>1</i>');
    p.insertAdjacentHTML('afterbegin', '2');
    p.insertAdjacentHTML('beforeend', '<b>3</b>');
    p.insertAdjacentHTML('afterend', '<!--4-->');
    assert.equal(div.innerHTML, '<i>1</i><p>2x<b>3</b></p><!--4-->');
  });

  it('throws for a place that is none, and for beside an element in no parent', async () => {
    const document = await page();
    const span = document.createElement('span');
    assert.throws(() => span.insertAdjacentHTML('inside', 'x'), { name: 'SyntaxError' });
    assert.throws(() => span.insertAdjacentHTML('afterend', 'x'), {
      name: 'NoModificationAllowedError',
    });
  });
});

describe('DOMParser', () => {
  it('parses markup as a document of its own, which a library walks', async () => {
    const document = await page();
    const parsed = new (globalThis as Dom).DOMParser().parseFromString(
      '<title>T</title><p class="x">a &amp; <b>b</b></p><!--c-->',
      'text/html',
    );
    assert.equal(parsed.contentType, 'text/html');
    assert.equal(parsed.head.innerHTML, '<title>T</title>');
    assert.equal(parsed.body.innerHTML, '<p class="x">a &amp; <b>b</b></p><!--c-->');
    assert.equal(parsed.querySelector('.x b').textContent, 'b');
    assert.notEqual(parsed, document);
  });

  it('parses a whole document, its head and its body, with their attributes', async () => {
    await page();
    const parser = new (globalThis as Dom).DOMParser();
    const parsed = parser.parseFromString(
      '<!doctype html><html lang="en"><head><title>T</title></head><!--c-->' +
        '<body class="b"><p>x<table></table><noscript><b>n</b></noscript></body></html>',
      'text/html',
    );
    assert.equal(
      [parsed.documentElement.getAttribute('lang'), parsed.body.className].join(' '),
      'en b',
    );
    assert.equal(parsed.head.innerHTML, '<title>T</title>');
    assert.equal(parsed.documentElement.childNodes[1].nodeType, 8);
    // No scripts run in it, so a <noscript> holds elements.
    assert.equal(parsed.body.innerHTML, '<p>x</p><table></table><noscript><b>n</b></noscript>');
    // With no doctype a document is in quirks mode, where a table leaves a paragraph open.
    const quirks = parser.parseFromString('<p>x<table></table>', 'text/html');
    assert.equal(quirks.body.innerHTML, '<p>x<table></table></p>');
  });

  it('parses an XML type as XML, its names as written, and says where it is not well-formed', async () => {
    await page();
    const parser = new (globalThis as Dom).DOMParser();
    const parsed = parser.parseFromString(
      '<Root xmlns="urn:a"><Child/><![CDATA[<x>]]></Root>',
      'application/xml',
    );
    assert.equal(parsed.contentType, 'application/xml');
    assert.deepEqual(
      [parsed.documentElement.nodeName, parsed.documentElement.namespaceURI],
      ['Root', 'urn:a'],
    );
    assert.deepEqual(
      [...parsed.documentElement.childNodes].map((node: Dom) => node.nodeName),
      ['Child', '#cdata-section'],
    );
    const svg = parser.parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'image/svg+xml',
    );
    assert.equal(svg.documentElement.namespaceURI, 'http://www.w3.org/2000/svg');
    const broken = parser.parseFromString('<a><b></a>', 'text/xml');
    assert.equal(broken.documentElement.localName, 'parsererror');
  });

  it('throws for a type it does not parse', async () => {
    await page();
    assert.throws(
      () => new (globalThis as Dom).DOMParser().parseFromString('', 'text/plain'),
      TypeError,
    );
  });
});

describe('XMLSerializer', () => {
  it('writes a drawing and an HTML element as XML', async () => {
    const document = await page();
    const div = document.createElement('div');
    div.innerHTML =
      '<p title="a&quot;b">x &amp; y<br></p><svg viewBox="0 0 1 1"><path d="M0 0"/><a xlink:href="#q"></a></svg>';
    const serializer = new (globalThis as Dom).XMLSerializer();
    assert.equal(
      serializer.serializeToString(div.firstChild),
      '<p xmlns="http://www.w3.org/1999/xhtml" title="a&quot;b">x &amp; y<br /></p>',
    );
    assert.equal(
      serializer.serializeToString(div.lastChild),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0"/><a xlink:href="#q"/></svg>',
    );
  });
});

describe("A table's parts", () => {
  it('lists the rows of a table and a section, and the cells of a row, live', async () => {
    const document = await page();
    const div = document.createElement('div');
    div.innerHTML =
      '<table><caption>c</caption><tfoot><tr id="f"></tr></tfoot><tbody><tr id="b"><td>1</td><th>2</th></tr></tbody><thead><tr id="h"></tr></thead></table>';
    const table = div.firstChild;
    const rows = table.rows;
    assert.deepEqual(
      [...rows].map((row: Dom) => row.id),
      ['h', 'b', 'f'],
    );
    assert.equal(table.rows, rows);
    assert.equal(table.tBodies.length, 1);
    assert.equal(table.tHead.localName, 'thead');
    assert.equal(table.tFoot.localName, 'tfoot');
    assert.equal(table.caption.textContent, 'c');
    const body = table.tBodies[0];
    assert.equal(body.rows.length, 1);
    assert.equal(body.rows[0].cells.length, 2);
    body.appendChild(document.createElement('tr'));
    assert.equal(rows.length, 4);
    assert.equal(document.createElement('table').tHead, null);
  });
});

@Component({
  selector: 'x-marked-up',
  template: `<span testID="label" [innerHTML]="label()"></span>`,
})
class MarkedUp {
  readonly host = inject(ElementRef).nativeElement;
  readonly label = signal<string | null>(
    'Files &amp; <b>folders</b> <i class="hint">3 &lt; 4</i><script>steal()</script><br>',
  );
}

describe('markup a template binds with [innerHTML]', () => {
  const markedUp = async () => {
    const app = await render(MarkedUp, { providers: [provideWebCompat()] });
    await settle();
    const label = (app.instance.host as Dom).children[0];
    const tags = () => [...label.children].map((each: Dom) => each.localName);
    return { page: app.instance, label, tags };
  };

  it('is drawn as the elements and text it is, but for what the sanitizer takes out', async () => {
    const { label, tags } = await markedUp();
    assert.equal(label.textContent, 'Files & folders 3 < 4');
    assert.deepEqual(tags(), ['b', 'i', 'br']);
    assert.equal(label.querySelector('i').getAttribute('class'), 'hint');
    assert.ok(screen.getByText('folders'));
    assert.equal(screen.queryByText('steal()'), null);
  });

  it('replaces what the element held when it changes, and empties it for none', async () => {
    const { page, label, tags } = await markedUp();
    page.label.set('<u>Only</u> this');
    await settle();
    assert.equal(label.textContent, 'Only this');
    assert.deepEqual(tags(), ['u']);
    // And as it is drawn: the old words gone from the screen, the new ones on it.
    assert.ok(screen.getByText(/Only/));
    assert.equal(screen.queryByText('folders'), null);
    page.label.set(null);
    await settle();
    assert.equal(label.textContent, '');
    assert.equal(screen.queryByText(/Only/), null);
  });
});
