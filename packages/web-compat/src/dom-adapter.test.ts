/**
 * Angular's DOM adapter, `getDOM()`, in an app that asked for the package: `Meta` makes and takes
 * away its tags with it, and Taiga UI's `provideTaiga()` calls `Meta` as the app starts.
 *
 * Angular takes an adapter once and never gives it back, so the one the package gives stays for
 * the rest of the process. This file's tests run in order in a process of their own, as each
 * test file does, and the first is the one that sees none given yet.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ɵgetDOM as getDOM } from '@angular/common';
import { Component, DOCUMENT, inject, provideEnvironmentInitializer } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { cleanup, render } from '@ng-native/testing';
import { WebCompatDomAdapter } from './dom-adapter.ts';
import { provideWebCompat } from './index.ts';

@Component({ selector: 'x-page', template: '<div></div>' })
class Page {
  readonly document: Document = inject(DOCUMENT);
  readonly meta = inject(Meta);
  readonly title = inject(Title);
}

const metasIn = (document: Document): Element[] => [...document.getElementsByTagName('meta')];

afterEach(() => cleanup());

describe("Angular's DOM adapter in an app that asked for the package", () => {
  it('is there once the app is up, for a provider that calls Meta as the app starts', async () => {
    const providers = [
      provideWebCompat(),
      provideEnvironmentInitializer(() => {
        inject(Meta).addTag({ name: 'viewport', content: 'width=device-width' });
      }),
    ];
    // Not before: a browser platform booted in the meantime sets its own.
    assert.equal(getDOM(), null);
    const { document } = (await render(Page, { providers })).instance;
    assert.ok(getDOM() instanceof WebCompatDomAdapter);
    const [tag] = metasIn(document);
    assert.equal(tag.getAttribute('content'), 'width=device-width');
    assert.equal(tag.parentNode, document.head);
  });

  it('lets Meta add a tag to the head, find it, change it and take it away', async () => {
    const { meta, document } = (await render(Page, { providers: [provideWebCompat()] })).instance;
    const tag = meta.addTag({ name: 'x', content: 'y' })!;
    assert.equal(tag.localName, 'meta');
    assert.equal(tag.parentNode, document.head);
    assert.equal(globalThis.document.head.contains(tag), true);
    assert.equal(meta.getTag("name='x'"), tag);
    // Added again, it is the one there.
    assert.equal(meta.addTag({ name: 'x', content: 'y' }), tag);
    meta.updateTag({ name: 'x', content: 'z' });
    assert.equal(tag.getAttribute('content'), 'z');
    meta.removeTag("name='x'");
    assert.equal(tag.parentNode, null);
    assert.equal(meta.getTag("name='x'"), null);
    assert.deepEqual(metasIn(document), []);
  });

  it('lets Title set the title of the head, and read it', async () => {
    const { title, document } = (await render(Page, { providers: [provideWebCompat()] })).instance;
    // A drawing's title is no title of the document's.
    const drawing = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const named = drawing.appendChild(
      document.createElementNS('http://www.w3.org/2000/svg', 'title'),
    );
    named.textContent = 'Chart';
    document.body.appendChild(drawing);
    assert.equal(title.getTitle(), '');
    title.setTitle('Orders');
    assert.equal(named.textContent, 'Chart');
    assert.equal(title.getTitle(), 'Orders');
    assert.equal(document.title, 'Orders');
    const element = document.head.querySelector('title')!;
    assert.equal(element.textContent, 'Orders');
    title.setTitle('  Open   orders ');
    assert.equal(document.title, 'Open orders');
    // Only ASCII white space is collapsed and stripped.
    title.setTitle('\u00a0a\u2003 b\u00a0');
    assert.equal(title.getTitle(), '\u00a0a\u2003 b\u00a0');
    title.setTitle('  Open   orders ');
    assert.equal(document.head.getElementsByTagName('title').length, 1);
    assert.equal(element.textContent, '  Open   orders ');
    // One a script writes is read, and the first is the one set.
    element.remove();
    const written = document.createElement('title');
    written.textContent = 'Written';
    document.head.appendChild(written);
    assert.equal(title.getTitle(), 'Written');
    title.setTitle('Set');
    assert.equal(written.textContent, 'Set');
    // Only the text directly in it, as Chrome reads it: an element in it is passed over.
    written.textContent = 'A ';
    const nested = document.createElement('span');
    nested.textContent = 'B';
    written.appendChild(nested);
    written.appendChild(document.createTextNode('  C'));
    assert.equal(document.title, 'A C');
    assert.equal(title.getTitle(), 'A C');
  });

  it('answers as the browser adapter does from the nodes and the document of the app', async () => {
    const { document } = (await render(Page, { providers: [provideWebCompat()] })).instance;
    const dom = getDOM();
    assert.equal(dom.supportsDOMEvents, true);
    assert.equal(dom.getDefaultDocument(), document);
    const made = dom.createElement('section');
    assert.equal(made.localName, 'section');
    assert.equal(dom.isElementNode(made), true);
    assert.equal(dom.isElementNode(document.createTextNode('a')), false);
    assert.equal(dom.isShadowRoot(document.createDocumentFragment()), false);
    const heard: string[] = [];
    const cancel = dom.onAndCancel(made, 'ping', (event: Event) => void heard.push(event.type));
    dom.dispatchEvent(made, new Event('ping'));
    cancel();
    dom.dispatchEvent(made, new Event('ping'));
    assert.deepEqual(heard, ['ping']);
    document.body.appendChild(made);
    dom.remove(made);
    assert.equal(made.parentNode, null);
    assert.equal(dom.getGlobalEventTarget(document, 'window'), globalThis);
    assert.equal(dom.getGlobalEventTarget(document, 'document'), document);
    assert.equal(dom.getGlobalEventTarget(document, 'body'), document.body);
    assert.equal(dom.getGlobalEventTarget(document, 'other'), null);
    const other = dom.createHtmlDocument();
    assert.notEqual(other, document);
    assert.equal(other.title, 'fakeTitle');
    assert.equal(dom.createElement('p', other).ownerDocument, other);
    assert.equal(made.ownerDocument, document);
    assert.equal(dom.getUserAgent(), globalThis.navigator.userAgent);
    assert.equal(dom.getCookie('session'), null);
  });

  it("reads the base path from the head's base, each time it is asked", async () => {
    const { document } = (
      await render(Page, { providers: [provideWebCompat({ url: 'https://shop.test/app' })] })
    ).instance;
    const dom = getDOM();
    assert.equal(dom.getBaseHref(document), null);
    const base = document.createElement('base');
    base.setAttribute('href', '/shop/');
    document.head.appendChild(base);
    assert.equal(dom.getBaseHref(document), '/shop/');
    // Relative to the page, and nothing kept from the answer before.
    base.setAttribute('href', 'admin/');
    assert.equal(dom.getBaseHref(document), '/app/admin/');
    base.remove();
    assert.equal(dom.getBaseHref(document), null);
  });

  it('speaks for the newest app up, and holds nothing of one that has gone', async () => {
    const one = (await render(Page, { providers: [provideWebCompat()] })).instance;
    const two = await render(Page, { providers: [provideWebCompat()] });
    const dom = getDOM();
    assert.equal(dom.getDefaultDocument(), two.instance.document);
    // Each app's Meta writes its own head.
    const ones = one.meta.addTag({ name: 'app', content: 'one' });
    const twos = two.instance.meta.addTag({ name: 'app', content: 'two' });
    assert.deepEqual(metasIn(one.document), [ones]);
    assert.deepEqual(metasIn(two.instance.document), [twos]);
    two.unmount();
    assert.equal(dom.getDefaultDocument(), one.document);
    cleanup();
    // Angular keeps it, but it holds nothing of the apps that have gone.
    assert.equal(getDOM(), dom);
    assert.equal(dom.getDefaultDocument(), globalThis.document);
    assert.notEqual(dom.getDefaultDocument(), one.document);
    const next = (await render(Page, { providers: [provideWebCompat()] })).instance;
    assert.equal(dom.getDefaultDocument(), next.document);
    const nexts = next.meta.addTag({ name: 'app', content: 'next' });
    assert.deepEqual(metasIn(next.document), [nexts]);
    assert.deepEqual(metasIn(one.document), [ones]);
  });
});
