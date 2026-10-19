/**
 * What `provideWebCompat()` adds, and when: nothing as the package is imported, all of it while
 * an app that asked for it is up, and none of it once the last such app is destroyed.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, ElementRef, inject, signal } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { registeredViewName } from '@ng-native/fabric';
import { cleanup, render, screen, userEvent } from '@ng-native/testing';

afterEach(cleanup);

/** What a library sees of an element: loosely typed, as its own code would be against the DOM. */
type Dom = any;

@Component({
  selector: 'x-clicks',
  imports: [Text, View],
  template: `<view testID="box" (click)="clicks.set(clicks() + 1)"
      ><text>{{ clicks() }}</text></view
    >
    <div id="clicks"></div>
    <button id="pressed"></button>`,
})
class Clicks {
  readonly host: Dom = inject(ElementRef).nativeElement;
  readonly document: Dom = inject(DOCUMENT);
  readonly clicks = signal(0);
}

@Component({ selector: 'x-page', imports: [View], template: '<view testID="page"></view>' })
class Page {
  readonly host: Dom = inject(ElementRef).nativeElement;
  readonly document: Dom = inject(DOCUMENT);
}

@Component({
  selector: 'x-inset',
  template: `<div testID="inset" [style.inset-inline-start]="'4px'"></div>`,
})
class Inset {}

/** The package, read the first time a test asks for it: see the first test. */
const load = () => import('./index.ts');

/** The globals there are, each as it is defined, to compare after. */
function globalsNow(): Map<string, PropertyDescriptor | undefined> {
  const names = [...Object.getOwnPropertyNames(globalThis), 'document', 'window', 'Node'];
  return new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
}

/** The members every engine node has on the prototype they share. */
const membersOf = (node: object): string[] =>
  Object.getOwnPropertyNames(Object.getPrototypeOf(node)).sort();

/** Whether a press on the box of a `Clicks` app is heard as its `(click)`. */
async function pressHeard(): Promise<boolean> {
  await userEvent.press(screen.getByTestId('box'));
  return screen.queryByText('1') !== null;
}

describe('provideWebCompat', () => {
  it('adds nothing as the package is imported', async () => {
    const plain = await render(Page);
    const members = membersOf(plain.instance.host);
    const globals = globalsNow();
    const { provideWebCompat } = await load();
    assert.equal(typeof provideWebCompat, 'function');
    assert.deepEqual(globalsNow(), globals, 'no global defined or replaced');
    assert.deepEqual(membersOf(plain.instance.host), members, 'no member on the nodes');
    cleanup();
    // And no renderer extension: a `(click)` on a view is not a press.
    await render(Clicks);
    assert.equal(await pressHeard(), false);
    assert.equal((globalThis as Dom).window, undefined);
  });

  it('adds its members, globals and listeners while the app is up, and takes them all away after', async () => {
    const { provideWebCompat } = await load();
    const members = membersOf((await render(Page)).instance.host);
    cleanup();
    const globals = globalsNow();
    const windowPrototype = Object.getPrototypeOf(globalThis);
    const buttonView = registeredViewName('button');
    // The engine's own, which `@defer (on viewport)` is given by the platform.
    const engineObserver = (globalThis as Dom).IntersectionObserver;

    const app = await render(Clicks, { providers: [provideWebCompat()] });
    const host = app.instance.host;
    const listened: string[] = [];
    globalThis.addEventListener('picked', () => void listened.push('window'));
    assert.equal(typeof host.getAttribute, 'function');
    assert.equal(typeof host.classList.add, 'function');
    assert.equal((globalThis as Dom).window, globalThis);
    assert.equal((globalThis as Dom).document, app.instance.document);
    assert.equal(typeof (globalThis as Dom).HTMLElement, 'function');
    assert.equal((globalThis as Dom).Node.ELEMENT_NODE, 1);
    assert.equal(typeof (globalThis as Dom).innerWidth, 'number');
    // The tree: its live lists, its observer and its walks, and the document as a node.
    const tree = ['MutationObserver', 'NodeList', 'HTMLCollection', 'TreeWalker', 'NodeFilter'];
    for (const name of [...tree, 'Text', 'DocumentFragment', 'DocumentType']) {
      assert.equal(typeof (globalThis as Dom)[name], name === 'NodeFilter' ? 'object' : 'function');
    }
    const children = host.childNodes;
    assert.equal(children.length, host.childList.length);
    assert.equal(typeof host.cloneNode, 'function');
    assert.equal(app.instance.document.doctype.parentNode, app.instance.document);
    const observer = new (globalThis as Dom).MutationObserver(() => {});
    observer.observe(host, { childList: true, subtree: true });
    assert.equal(await pressHeard(), true);
    // HTML: markup, names, attributes as nodes, what HTML reflects, and the elements it has.
    const html = ['DOMParser', 'XMLSerializer', 'Attr', 'Document', 'HTMLDivElement'];
    for (const name of [...html, 'DOMStringMap', 'ProcessingInstruction']) {
      assert.equal(typeof (globalThis as Dom)[name], 'function', name);
    }
    const div = host.lastElementChild.previousElementSibling;
    assert.equal(div.outerHTML, '<div id="clicks"></div>');
    assert.equal(div.namespaceURI, 'http://www.w3.org/1999/xhtml');
    assert.equal(div.title, '');
    assert.equal(typeof div.dataset, 'object');
    assert.equal(div.attributes.length, 1);
    assert.equal(typeof app.instance.document.implementation.createHTMLDocument, 'function');
    assert.equal((globalThis as Dom).clicks, div, 'an element with an id is a global by it');
    assert.equal(registeredViewName('button'), 'View');
    assert.equal(host.lastElementChild.props['accessibilityRole'], 'button');
    // Selectors: what an element matches, and what is under it and the document that does.
    const selectors = ['matches', 'webkitMatchesSelector', 'closest'];
    for (const name of [...selectors, 'querySelector', 'querySelectorAll']) {
      assert.equal(typeof host[name], 'function', name);
    }
    assert.equal(host.querySelector('#clicks'), div);
    assert.equal(div.matches('#clicks'), true);
    assert.equal(app.instance.document.querySelector('#pressed'), host.lastElementChild);
    // CSSOM: sheets and their rules, inline and computed style, and the `CSS` namespace.
    const cssom = ['CSSStyleSheet', 'CSSRule', 'CSSRuleList', 'CSSStyleRule', 'StyleSheet'];
    for (const name of [...cssom, 'CSSStyleDeclaration', 'MediaList', 'getComputedStyle']) {
      assert.equal(typeof (globalThis as Dom)[name], 'function', name);
    }
    assert.equal(typeof (globalThis as Dom).CSS.supports, 'function');
    div.style.width = '10px';
    assert.equal(div.style.width, '10px');
    // Over the runtime's own, which answers nothing.
    assert.equal((globalThis as Dom).getComputedStyle(div).width, '10px');
    const style = app.instance.document.createElement('style');
    style.textContent = '#pressed { width: 5px }';
    app.instance.document.head.appendChild(style);
    assert.equal(app.instance.document.styleSheets.length, 1);
    assert.equal(style.sheet.cssRules.length, 1);
    // Geometry: where an element is and how big, scrolling it, the window, media queries and the
    // observers, over the engine's own `IntersectionObserver`.
    const geometry = ['DOMRect', 'DOMRectReadOnly', 'DOMRectList', 'ResizeObserver'];
    geometry.push('ResizeObserverEntry', 'ResizeObserverSize', 'IntersectionObserverEntry');
    geometry.push('MediaQueryList', 'matchMedia', 'scroll', 'scrollTo', 'scrollBy');
    for (const name of geometry) {
      assert.equal(typeof (globalThis as Dom)[name], 'function', name);
    }
    assert.notEqual((globalThis as Dom).IntersectionObserver, engineObserver);
    assert.equal(typeof (globalThis as Dom).IntersectionObserver, 'function');
    assert.equal((globalThis as Dom).matchMedia('(min-width: 0px)').matches, true);
    assert.equal(typeof (globalThis as Dom).screen.width, 'number');
    assert.equal(typeof (globalThis as Dom).visualViewport.height, 'number');
    assert.equal((globalThis as Dom).screenX, 0);
    const placed = ['getBoundingClientRect', 'getClientRects', 'scrollIntoView', 'scrollBy'];
    for (const name of placed) assert.equal(typeof div[name], 'function', name);
    assert.deepEqual([div.offsetWidth, div.clientHeight, div.scrollTop], [0, 0, 0]);
    assert.equal(app.instance.document.scrollingElement, host.engine.root);
    assert.equal(div.scrollsOverflow, true, 'what overflows it scrolls, where its style says');

    cleanup();
    assert.deepEqual(globalsNow(), globals, 'every global as it was, the document too');
    assert.deepEqual(membersOf(host), members, 'every node member as it was');
    assert.equal(host.getAttribute, undefined);
    // The runtime's own `getComputedStyle` is back, which the comparison above says.
    for (const name of [...tree, ...html, ...cssom, 'CSS', 'MediaList', ...geometry]) {
      assert.equal((globalThis as Dom)[name], undefined, name);
    }
    assert.equal((globalThis as Dom).IntersectionObserver, engineObserver);
    assert.deepEqual(
      [(globalThis as Dom).screen, (globalThis as Dom).screenX],
      [undefined, undefined],
    );
    for (const name of [...placed, 'offsetWidth', 'scrollTop']) {
      assert.equal(div[name], undefined, name);
    }
    assert.deepEqual([div.style, style.sheet], [undefined, undefined]);
    assert.deepEqual(
      [host.childNodes, host.cloneNode, host.append],
      [undefined, undefined, undefined],
    );
    assert.deepEqual(
      [div.innerHTML, div.namespaceURI, div.title, div.dataset, div.attributes],
      [undefined, undefined, undefined, undefined, undefined],
    );
    for (const name of [...selectors, 'querySelector', 'querySelectorAll']) {
      assert.equal(host[name], undefined, name);
    }
    assert.equal(Object.getPrototypeOf(globalThis), windowPrototype, 'no named properties');
    assert.equal((globalThis as Dom).clicks, undefined);
    assert.equal(registeredViewName('button'), buttonView);
    // The engine's own, which has no more than `contains`.
    assert.equal(host.classList.add, undefined);
    // The window's listeners went with it, and the renderer's extension.
    const again = await render(Clicks);
    assert.equal(again.instance.host.getAttribute, undefined);
    assert.equal(again.instance.host.childList.at(-1).props['accessibilityRole'], undefined);
    assert.equal(await pressHeard(), false);
    cleanup();
    await render(Page, { providers: [provideWebCompat()] });
    globalThis.dispatchEvent(new Event('picked'));
    assert.deepEqual(listened, []);
  });

  it('stays while any app that asked for it is up, and gives the document to the newest', async () => {
    const { provideWebCompat } = await load();
    const before = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const one = await render(Page, { providers: [provideWebCompat()] });
    const two = await render(Page, { providers: [provideWebCompat()] });
    assert.equal((globalThis as Dom).document, two.instance.document);
    two.unmount();
    assert.equal((globalThis as Dom).document, one.instance.document);
    assert.equal(typeof one.instance.host.getAttribute, 'function');
    one.unmount();
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'document'), before);
    assert.equal(one.instance.host.getAttribute, undefined);
  });

  it('changes nothing in an app that did not ask, while one that did is up', async () => {
    const { provideWebCompat } = await load();
    await render(Page, { providers: [provideWebCompat()] });
    const plain = await render(Clicks);
    assert.equal(await pressHeard(), false);
    // Its attributes are the props they are written as: an id is no native id.
    const box = plain.instance.host.lastElementChild.previousElementSibling;
    assert.deepEqual([box.props['id'], box.props['nativeID']], ['clicks', undefined]);
    assert.equal(box.ownerDocument, null);
    // What overflows its elements is laid out as it is without the package: none scrolls.
    assert.equal(box.scrollsOverflow, undefined);
    // An element of it watched for being in sight is watched by the engine's own observer, which
    // hears none of its commits.
    plain.fabric.frames.set(String(box.committed.viewName), { x: 0, y: 0, width: 5, height: 5 });
    const seen: Dom[] = [];
    const observer = new (globalThis as Dom).IntersectionObserver(function (
      this: unknown,
      entries: Dom[],
    ) {
      seen.push(this, ...entries);
    });
    observer.observe(box);
    await Promise.resolve();
    assert.equal(Object.hasOwn(box.engine, 'commit'), false);
    assert.equal(seen[0] === observer && seen[1].target === box, true);
    assert.equal(seen[1].isIntersecting, true);
    observer.disconnect();
    // Its button has no role given it, and its element with an id is no global.
    assert.equal(plain.instance.host.lastElementChild.props['accessibilityRole'], undefined);
    assert.equal((globalThis as Dom).clicks, undefined);
    // A style it binds is set as written, as the renderer sets one: no inset read as a side.
    await render(Inset);
    assert.equal(screen.getByTestId('inset').props['start'], undefined);
  });

  it('adds it all again for an app that asks after the last one went', async () => {
    const { provideWebCompat } = await load();
    await render(Page, { providers: [provideWebCompat()] });
    cleanup();
    const app = await render(Clicks, { providers: [provideWebCompat()] });
    assert.equal(typeof app.instance.host.getAttribute, 'function');
    assert.equal((globalThis as Dom).window, globalThis);
    assert.equal(await pressHeard(), true);
  });
});
