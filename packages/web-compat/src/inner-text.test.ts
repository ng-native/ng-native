/**
 * `innerText` and `outerText`: the text an element renders, by the styles written and those a
 * browser gives each element, and the text and line breaks a string is when one is written.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({ selector: 'x-page', template: `<div id="page"></div>` })
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

const page = async (): Promise<Dom> => {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  return app.fixture.componentInstance.document;
};

/** The `innerText` of a `<div>` in the page holding `markup`. */
function rendered(document: Dom, markup: string): string {
  const div = document.createElement('div');
  document.body.appendChild(div);
  div.innerHTML = markup;
  const text = div.innerText;
  assert.equal(div.outerText, text);
  div.remove();
  return text;
}

describe('innerText', () => {
  it('collapses white space as CSS does, and keeps it in a <pre>', async () => {
    const document = await page();
    assert.equal(rendered(document, ' abc  \n<span>def </span> ghi '), 'abc def ghi');
    assert.equal(rendered(document, 'abc <br> def'), 'abc\ndef');
    assert.equal(rendered(document, '<pre> a  b\n c</pre>'), ' a  b\n c');
    assert.equal(
      rendered(document, "<span style='white-space:pre-line'> a  b\n c</span>"),
      'a b\nc',
    );
    assert.equal(rendered(document, 'abc <input> def'), 'abc  def');
  });

  it('breaks lines around blocks, a blank line around a <p>, and tabs between cells', async () => {
    const document = await page();
    assert.equal(rendered(document, '123<div>abc</div><div></div>def'), '123\nabc\ndef');
    assert.equal(rendered(document, '<p>abc</p> <p>def</p>'), 'abc\n\ndef');
    assert.equal(rendered(document, "a<span style='display:inline-block'> b </span>c"), 'abc');
    assert.equal(
      rendered(document, '<table><tr><td>a<td>b</tr><tr><td>c<td></table>'),
      'a\tb\nc\t',
    );
  });

  it('leaves out what is hidden, and is the text whole where the element is not rendered', async () => {
    const document = await page();
    assert.equal(
      rendered(document, "1<span style='display:none'>2</span><b style='visibility:hidden'>3</b>"),
      '1',
    );
    assert.equal(rendered(document, '<textarea>x</textarea><select><option>o</select>'), 'o');
    const hidden = document.createElement('div');
    hidden.setAttribute('style', 'display: none');
    hidden.innerHTML = ' a  <p>b</p>';
    document.body.appendChild(hidden);
    assert.equal(hidden.innerText, ' a  b');
    hidden.remove();
    assert.equal(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg').innerText,
      undefined,
    );
  });

  it('transforms text as its style says', async () => {
    const document = await page();
    assert.equal(
      rendered(document, "<b style='text-transform:uppercase'>stra\xDFe</b>"),
      'STRASSE',
    );
    const div = document.createElement('div');
    document.body.appendChild(div);
    div.innerHTML = '<i>abc</i>';
    div.setAttribute('style', 'text-transform: capitalize');
    assert.equal(div.innerText, 'Abc');
    div.remove();
  });
});

describe('innerText and outerText written', () => {
  it('put in text and a <br> for each line break', async () => {
    const document = await page();
    const div = document.createElement('div');
    div.innerHTML = '<b>old</b>';
    div.innerText = 'a\r\nb\n';
    assert.equal(div.innerHTML, 'a<br>b<br>');
    div.innerText = null;
    assert.equal(div.childNodes.length, 0);
  });

  it('replace the element, joined to the texts beside it', async () => {
    const document = await page();
    const div = document.createElement('div');
    div.innerHTML = 'A <span>B</span> C';
    div.childNodes[1].outerText = 'x';
    assert.equal(div.childNodes.length, 1);
    assert.equal(div.innerHTML, 'A x C');
    assert.throws(() => (document.createElement('span').outerText = ''), {
      name: 'NoModificationAllowedError',
    });
  });
});
