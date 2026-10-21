/**
 * HTML's parsing methods: `setHTML`, `appendHTML` and the rest, safe and `Unsafe`, parse markup
 * as the content of where it goes, sanitize it as they are told, and put it in place.
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

/** A `<div>` holding `<b>ref</b>`, and the `<b>`. */
function holder(document: Dom): { div: Dom; ref: Dom } {
  const div = document.createElement('div');
  const ref = document.createElement('b');
  ref.textContent = 'ref';
  div.appendChild(ref);
  return { div, ref };
}

describe('HTML parsing methods', () => {
  it('put markup at the end, the start, before, after and in place of a node', async () => {
    const document = await page();
    const cases: [string, string][] = [
      ['appendHTML', '<b>ref</b><i>x</i>'],
      ['prependHTML', '<i>x</i><b>ref</b>'],
      ['beforeHTML', '<i>x</i><b>ref</b>'],
      ['afterHTML', '<b>ref</b><i>x</i>'],
      ['replaceWithHTML', '<i>x</i>'],
    ];
    for (const [method, expected] of cases) {
      for (const suffix of ['', 'Unsafe']) {
        const { div, ref } = holder(document);
        const receiver = method === 'appendHTML' || method === 'prependHTML' ? div : ref;
        assert.equal(receiver[method + suffix]('<i>x</i>'), undefined);
        assert.equal(div.innerHTML, expected, method + suffix);
      }
    }
  });

  it('parse as the content of the parent, or of the template the content is of', async () => {
    const document = await page();
    const tr = document.createElement('tr');
    tr.appendHTML('<td>x</td>');
    assert.equal(tr.innerHTML, '<td>x</td>');
    const div = document.createElement('div');
    div.appendHTML('<td>x</td>');
    assert.equal(div.innerHTML, 'x');
    const template = document.createElement('template');
    const span = document.createElement('span');
    template.content.appendChild(span);
    span.afterHTML('<td>y</td>');
    assert.equal(template.innerHTML, '<span></span><td>y</td>');
  });

  it('take out what runs a script where they are safe, and what the sanitizer says', async () => {
    const document = await page();
    const div = document.createElement('div');
    div.setHTML('<a href=" javascript:x" onclick="y" title="t">a</a><script>z</script><p>p</p>');
    assert.equal(div.innerHTML, '<a title="t">a</a><p>p</p>');
    div.setHTMLUnsafe('<script>z</script><p>p</p><!--c-->');
    assert.equal(div.innerHTML, '<script>z</script><p>p</p><!--c-->');
    div.setHTMLUnsafe('<i a="1" b="2">i</i><p>p</p><!--c-->', {
      sanitizer: { removeElements: ['p'], removeAttributes: ['a'], comments: false },
    });
    assert.equal(div.innerHTML, '<i b="2">i</i>');
    div.setHTML('<u><i>i</i></u><p>p</p><s>s</s>', {
      sanitizer: { elements: ['i', 'p'], replaceWithChildrenElements: ['u'] },
    });
    assert.equal(div.innerHTML, '<i>i</i><p>p</p>');
  });

  it('put nothing in a script where they are safe', async () => {
    const document = await page();
    const script = document.createElement('script');
    script.setHTML('<span>x</span>');
    script.appendHTML('<span>x</span>');
    assert.equal(script.childNodes.length, 0);
    script.appendHTMLUnsafe('1');
    const text = script.firstChild;
    text.afterHTML('<span>x</span>');
    assert.equal(script.childNodes.length, 1);
  });

  it('refuse a place no markup goes, and do nothing beside a node in no parent', async () => {
    const document = await page();
    const html = document.createElement('html');
    const body = html.appendChild(document.createElement('body'));
    assert.throws(() => html.appendHTML('x'), { name: 'HierarchyRequestError' });
    assert.throws(() => body.afterHTML('x'), { name: 'HierarchyRequestError' });
    const fragment = document.createDocumentFragment();
    const span = fragment.appendChild(document.createElement('span'));
    assert.throws(() => span.beforeHTML('x'), { name: 'HierarchyRequestError' });
    const template = document.createElement('template');
    const child = template.appendChild(document.createElement('div'));
    assert.throws(() => child.replaceWithHTMLUnsafe('x'), { name: 'HierarchyRequestError' });
    assert.equal(document.createTextNode('t').afterHTML('<i>x</i>'), undefined);
  });
});
