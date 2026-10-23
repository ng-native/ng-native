/**
 * `<iframe>`: a document and a window of its own while it is in the page, from `about:blank`,
 * `srcdoc` or what `src` names, with `load` once it is there.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import type { Engine, EngineNode } from '@ng-native/fabric';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat, type FrameLoader } from './index.ts';
import { frameCreated, framesLoaded, loadFramesWith } from './frame.ts';
import { showFramesAs } from './frame-view.ts';

/** What a library sees of a node or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({ selector: 'x-page', template: '' })
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

const FILES: Record<string, { body: string; contentType?: string }> = {
  'https://shop.example/frame.html': {
    body: '<!doctype html><title>In a frame</title><p id="here">Hello</p>',
  },
  'https://shop.example/quirky.html': { body: '<p>No doctype</p>' },
  'https://shop.example/dummy.xml': {
    body: '<?xml version="1.0"?><foo>Dummy XML document</foo>',
    contentType: 'application/xml',
  },
  'https://shop.example/dummy.xhtml': {
    body:
      '<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Dummy</title>' +
      '</head><body /></html>',
    contentType: 'application/xhtml+xml',
  },
  'https://shop.example/notes.txt': { body: 'a < b', contentType: 'text/plain' },
  'https://other.example/frame.html': { body: '<p id="theirs">Elsewhere</p>' },
};

const read: FrameLoader = (url) => FILES[url];

const page = async (loadFrame: FrameLoader = read): Promise<Dom> => {
  const providers = [
    provideWebCompat({ url: 'https://shop.example/', loadFrame, frames: 'emulated' }),
  ];
  const app = await render(Page, { providers });
  await settle();
  return app.fixture.componentInstance.document;
};

/** The next `load` an element hears. */
const loadOf = (element: Dom) =>
  new Promise<void>((resolve) => element.addEventListener('load', () => resolve(), { once: true }));

/** An iframe put in the page with these attributes, once its document has arrived. */
async function framed(document: Dom, attributes: Record<string, string>): Promise<Dom> {
  const iframe = document.createElement('iframe');
  for (const [name, value] of Object.entries(attributes)) iframe.setAttribute(name, value);
  const loading = loadOf(iframe);
  document.body.appendChild(iframe);
  await loading;
  return iframe;
}

describe('iframe', () => {
  it("goes where its document's location is set, as its window's is", async () => {
    const document = await page();
    const iframe = await framed(document, { src: 'https://shop.example/frame.html' });
    const loading = loadOf(iframe);
    iframe.contentDocument.location = 'https://other.example/frame.html';
    await loading;
    assert.ok(iframe.contentDocument.getElementById('theirs'));
  });

  it('has no document or window until it is in the page, and none once it is out', async () => {
    const document = await page();
    const iframe = document.createElement('iframe');
    assert.equal(iframe.contentDocument, null);
    assert.equal(iframe.contentWindow, null);
    document.body.appendChild(iframe);
    const window = iframe.contentWindow;
    assert.ok(iframe.contentDocument);
    iframe.remove();
    assert.equal(iframe.contentDocument, null);
    assert.equal(iframe.contentWindow, null);
    assert.equal(window.closed, true);
  });

  it('is about:blank as it is put in, and hears load at once', async () => {
    const document = await page();
    const iframe = document.createElement('iframe');
    let heard = 0;
    iframe.addEventListener('load', () => heard++);
    document.body.appendChild(iframe);
    assert.equal(heard, 1);
    const inner = iframe.contentDocument;
    assert.equal(inner.URL, 'about:blank');
    assert.equal(inner.documentElement.localName, 'html');
    assert.deepEqual(
      [...inner.documentElement.children].map((each: Dom) => each.localName),
      ['head', 'body'],
    );
    assert.equal(inner.body.childNodes.length, 0);
    assert.equal(inner.doctype, null);
    assert.equal(inner.compatMode, 'BackCompat');
    assert.notEqual(inner, document);
  });

  it('has a window that is its document’s, in the page’s window', async () => {
    const document = await page();
    const iframe = document.createElement('iframe');
    iframe.setAttribute('name', 'inner');
    document.body.appendChild(iframe);
    const window = iframe.contentWindow;
    const globals = globalThis as Dom;
    assert.equal(window.document, iframe.contentDocument);
    assert.equal(iframe.contentDocument.defaultView, window);
    assert.equal(window.window, window);
    assert.equal(window.self, window);
    assert.equal(window.frameElement, iframe);
    assert.equal(window.parent, globals);
    assert.equal(window.top, globals);
    assert.equal(window.name, 'inner');
    assert.equal(window.location.href, 'about:blank');
    // The page's classes and timers.
    assert.equal(window.DOMException, globals.DOMException);
    assert.equal(window.Element, globals.Element);
    assert.equal(typeof window.setTimeout, 'function');
    assert.ok(iframe.contentDocument.createElement('p') instanceof window.HTMLElement);
    // What a script sets on it is its own.
    window.answer = 42;
    assert.equal(window.answer, 42);
    assert.equal(globals.answer, undefined);
  });

  it('is at the page’s origin at about:blank and srcdoc, as a browser has it', async () => {
    const document = await page();
    const blank = document.createElement('iframe');
    document.body.appendChild(blank);
    assert.equal(blank.contentWindow.location.origin, 'https://shop.example');
    const held = await framed(document, { srcdoc: '<p>Own</p>' });
    assert.equal(held.contentWindow.location.href, 'about:srcdoc');
    assert.equal(held.contentWindow.location.origin, 'https://shop.example');
  });

  it('is at the origin of the document it is in at about:blank, there or in another frame', async () => {
    const document = await page();
    const outer = await framed(document, { src: 'https://other.example/frame.html' });
    const inner = outer.contentDocument.createElement('iframe');
    outer.contentDocument.body.appendChild(inner);
    assert.equal(inner.contentWindow.location.origin, 'https://other.example');
  });

  it("is at the page's own origin, and not at a location the runtime had", async () => {
    const scope = globalThis as Dom;
    scope.location = { href: 'http://runtime.example/', origin: 'http://runtime.example' };
    try {
      const document = await page();
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      const window = iframe.contentWindow;
      assert.equal(window.location.origin, 'https://shop.example');
      const heard: string[] = [];
      window.addEventListener('message', (event: Dom) => heard.push(event.origin));
      window.postMessage('hi', '/');
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.deepEqual(heard, ['https://shop.example']);
    } finally {
      delete scope.location;
    }
  });

  it('resolves against the first <base> with an href', async () => {
    const document = await page();
    const iframe = await framed(document, {
      srcdoc: '<base target="_top"><base href="https://cdn.example/">',
    });
    assert.equal(iframe.contentDocument.baseURI, 'https://cdn.example/');
  });

  it('makes elements its document owns', async () => {
    const document = await page();
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const inner = iframe.contentDocument;
    const p = inner.createElement('p');
    inner.body.appendChild(p);
    assert.equal(p.ownerDocument, inner);
    assert.equal(inner.body.ownerDocument, inner);
    assert.equal(document.body.ownerDocument, document);
  });

  it('parses srcdoc as a document, and hears load after', async () => {
    const document = await page();
    const iframe = document.createElement('iframe');
    iframe.setAttribute('srcdoc', '<!doctype html><p id="x">Hi <b>there</b></p>');
    let heard = 0;
    iframe.addEventListener('load', () => heard++);
    document.body.appendChild(iframe);
    assert.equal(heard, 0);
    await loadOf(iframe);
    const inner = iframe.contentDocument;
    assert.equal(inner.URL, 'about:srcdoc');
    assert.equal(inner.getElementById('x').textContent, 'Hi there');
    assert.equal(inner.compatMode, 'CSS1Compat');
    assert.equal(inner.doctype.name, 'html');
    assert.equal(iframe.contentWindow.document, inner);
  });

  it('loads what src names, resolved against the page', async () => {
    const document = await page();
    const iframe = await framed(document, { src: 'frame.html' });
    const inner = iframe.contentDocument;
    assert.equal(inner.URL, 'https://shop.example/frame.html');
    assert.equal(inner.title, 'In a frame');
    assert.equal(inner.querySelector('#here').textContent, 'Hello');
    assert.equal(inner.contentType, 'text/html');
    assert.equal(iframe.contentWindow.location.pathname, '/frame.html');
  });

  it('is in quirks mode for markup with no doctype', async () => {
    const document = await page();
    const iframe = await framed(document, { src: 'quirky.html' });
    assert.equal(iframe.contentDocument.compatMode, 'BackCompat');
  });

  it('parses an XML document as XML', async () => {
    const document = await page();
    const iframe = await framed(document, { src: '/dummy.xml' });
    const inner = iframe.contentDocument;
    assert.equal(inner.contentType, 'application/xml');
    assert.equal(inner.documentElement.textContent, 'Dummy XML document');
    const made = inner.createElement('FooBar');
    assert.deepEqual([made.localName, made.namespaceURI], ['FooBar', null]);
  });

  it('parses XHTML as XML, its elements HTML', async () => {
    const document = await page();
    const iframe = await framed(document, { src: '/dummy.xhtml' });
    const inner = iframe.contentDocument;
    assert.equal(inner.documentElement.namespaceURI, 'http://www.w3.org/1999/xhtml');
    assert.equal(inner.documentElement.textContent, 'Dummy');
    assert.equal(inner.doctype.name, 'html');
    const made = inner.createElement('Foo');
    assert.deepEqual(
      [made.namespaceURI, made.localName, made.tagName],
      ['http://www.w3.org/1999/xhtml', 'Foo', 'Foo'],
    );
    assert.equal(inner.documentElement.tagName, 'html');
  });

  it('shows text in a pre', async () => {
    const document = await page();
    const iframe = await framed(document, { src: '/notes.txt' });
    const inner = iframe.contentDocument;
    assert.equal(inner.contentType, 'text/plain');
    assert.equal(inner.body.firstChild.localName, 'pre');
    assert.equal(inner.body.textContent, 'a < b');
  });

  it('still hears load where src cannot be read', async () => {
    const document = await page(() => undefined);
    const iframe = await framed(document, { src: '/missing.html' });
    assert.equal(iframe.contentDocument.URL, 'about:blank');
  });

  it('is about:blank again where a page it goes to after one cannot be read', async () => {
    const document = await page();
    const iframe = await framed(document, { src: '/frame.html' });
    const loading = loadOf(iframe);
    iframe.src = '/missing.html';
    await loading;
    assert.equal(iframe.contentDocument.URL, 'about:blank');
    assert.equal(iframe.contentDocument.getElementById('here'), null);
  });

  it('goes to a fragment of its document in place, with no load', async () => {
    const asked: string[] = [];
    const document = await page((url) => (asked.push(url), read(url)));
    const iframe = await framed(document, { src: '/frame.html' });
    const inner = iframe.contentDocument;
    iframe.contentWindow.location.hash = 'here';
    await framesLoaded();
    assert.equal(iframe.contentDocument, inner);
    assert.equal(inner.URL, 'https://shop.example/frame.html#here');
    assert.deepEqual(asked, ['https://shop.example/frame.html']);
    iframe.contentWindow.location.reload();
    await framesLoaded();
    assert.equal(asked.length, 2, 'a reload reads it again');
  });

  it('closes the frames of a document it replaces', async () => {
    const document = await page();
    const outer = await framed(document, { src: '/frame.html' });
    const inner = outer.contentDocument.createElement('iframe');
    outer.contentDocument.body.appendChild(inner);
    const window = inner.contentWindow;
    assert.equal(window.closed, false);
    const loading = loadOf(outer);
    outer.src = '/quirky.html';
    await loading;
    assert.equal(window.closed, true);
    assert.equal(window.parent, null);
  });

  it('goes where src says once it is set again, and the window stays', async () => {
    const document = await page();
    const iframe = await framed(document, { src: '/frame.html' });
    const window = iframe.contentWindow;
    const loading = loadOf(iframe);
    iframe.src = '/quirky.html';
    await loading;
    assert.equal(iframe.contentDocument.URL, 'https://shop.example/quirky.html');
    assert.equal(iframe.contentWindow, window);
    assert.equal(window.document, iframe.contentDocument);
  });

  it('goes back to src once srcdoc is taken away, and to about:blank once src is', async () => {
    const document = await page();
    const iframe = await framed(document, { src: '/frame.html', srcdoc: '<p>Own</p>' });
    assert.equal(iframe.contentDocument.URL, 'about:srcdoc');
    let loading = loadOf(iframe);
    iframe.removeAttribute('srcdoc');
    await loading;
    assert.equal(iframe.contentDocument.URL, 'https://shop.example/frame.html');
    loading = loadOf(iframe);
    iframe.removeAttribute('src');
    await loading;
    assert.equal(iframe.contentDocument.URL, 'about:blank');
  });

  it('is waited for by framesLoaded', async () => {
    let arrive: (() => void) | undefined;
    const document = await page(
      (url) =>
        new Promise((resolve) => {
          arrive = () => resolve(FILES[url]);
        }),
    );
    const iframe = document.createElement('iframe');
    iframe.src = '/frame.html';
    document.body.appendChild(iframe);
    let done = false;
    const waiting = framesLoaded().then(() => (done = true));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(done, false);
    arrive!();
    await waiting;
    assert.equal(iframe.contentDocument.title, 'In a frame');
  });

  it('is written into with open, write and close', async () => {
    const document = await page();
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const inner = iframe.contentDocument;
    inner.open();
    inner.write('<!doctype html><style>p { color: red }</style>');
    inner.write('<p>Printed</p>');
    inner.close();
    assert.equal(inner.body.textContent, 'Printed');
    assert.equal(inner.head.firstChild.localName, 'style');
    assert.equal(inner.compatMode, 'CSS1Compat');
    assert.equal(iframe.contentDocument, inner);
  });

  it('hears postMessage as a message, after the task that sent it', async () => {
    const document = await page();
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const window = iframe.contentWindow;
    const heard: Dom[] = [];
    window.addEventListener('message', (event: Dom) => heard.push(event));
    window.postMessage({ say: 'hi' }, '*');
    assert.equal(heard.length, 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(heard.length, 1);
    assert.deepEqual(heard[0].data, { say: 'hi' });
    assert.equal(heard[0].source, globalThis);
  });

  it('hears a message for the origin it is at, and throws for one that cannot be copied', async () => {
    const document = await page();
    const iframe = await framed(document, { src: 'https://other.example/frame.html' });
    const window = iframe.contentWindow;
    const heard: string[] = [];
    window.addEventListener('message', (event: Dom) => heard.push(event.data));
    window.postMessage('theirs', 'https://other.example');
    window.postMessage('ours', 'https://shop.example');
    window.postMessage('own', '/');
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(heard, ['theirs']);
    assert.throws(() => window.postMessage(() => {}, '*'), { name: 'DataCloneError' });
  });

  it("hears a message for the app's scheme, and throws for a target that is no URL", async () => {
    const providers = [provideWebCompat({ url: 'canary://', frames: 'emulated' })];
    const app = await render(Page, { providers });
    await settle();
    const document = app.fixture.componentInstance.document;
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const window = iframe.contentWindow;
    const heard: string[] = [];
    window.addEventListener('message', (event: Dom) => heard.push(event.data));
    window.postMessage('ours', 'canary://');
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(heard, ['ours']);
    assert.throws(() => window.postMessage('x', 'foo'), { name: 'SyntaxError' });
  });

  it('throws for a URL its location cannot go to, as a browser does', async () => {
    const document = await page();
    const iframe = await framed(document, { src: 'https://shop.example/frame.html' });
    const { location } = iframe.contentWindow;
    assert.throws(() => location.assign('http://['), { name: 'SyntaxError' });
    assert.throws(() => location.replace('http://['), { name: 'SyntaxError' });
    assert.throws(() => (location.href = 'http://['), { name: 'SyntaxError' });
    assert.equal(location.href, 'https://shop.example/frame.html');
  });

  it('calls its own window’s onload, and not the page’s', async () => {
    const document = await page();
    const globals = globalThis as Dom;
    let pages = 0;
    let own = 0;
    globals.onload = () => pages++;
    try {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('srcdoc', '<p>x</p>');
      document.body.appendChild(iframe);
      assert.equal(iframe.contentWindow.onload, null);
      iframe.contentWindow.onload = () => own++;
      await loadOf(iframe);
      assert.deepEqual([pages, own], [0, 1]);
    } finally {
      delete globals.onload;
    }
  });

  it('opens each iframe once the whole of what a script puts in is there', async () => {
    const document = await page();
    const fragment = document.createDocumentFragment();
    const first = fragment.appendChild(document.createElement('iframe'));
    const second = fragment.appendChild(document.createElement('iframe'));
    const seen: unknown[] = [];
    first.addEventListener('load', () =>
      seen.push(second.isConnected, second.contentWindow, (globalThis as Dom).frames.length),
    );
    document.body.append(fragment);
    assert.deepEqual(seen, [true, null, 1]);
    assert.ok(second.contentWindow);
  });

  it('is cloned with its URL and the base URL it had', async () => {
    const document = await page();
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const inner = iframe.contentDocument;
    assert.equal(inner.baseURI, 'https://shop.example/');
    const base = inner.createElement('base');
    base.setAttribute('href', 'https://cdn.example/a/');
    inner.head.appendChild(base);
    assert.equal(inner.baseURI, 'https://cdn.example/a/');
    const shallow = inner.cloneNode(false);
    const deep = inner.cloneNode(true);
    base.remove();
    iframe.remove();
    assert.deepEqual([shallow.URL, shallow.baseURI], ['about:blank', 'https://cdn.example/a/']);
    assert.deepEqual([deep.URL, deep.baseURI], ['about:blank', 'https://cdn.example/a/']);
    assert.equal(deep.body.localName, 'body');
  });

  it('scrolls its body in quirks mode and its root in standards mode', async () => {
    const document = await page();
    const quirky = document.createElement('iframe');
    document.body.appendChild(quirky);
    assert.equal(quirky.contentDocument.scrollingElement, quirky.contentDocument.body);
    const standard = await framed(document, { srcdoc: '<!doctype html><p>x</p>' });
    const inner = standard.contentDocument;
    assert.equal(inner.scrollingElement, inner.documentElement);
  });

  it('is the size its width and height say, or 300 by 150', async () => {
    const document = await page();
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const window = iframe.contentWindow;
    assert.deepEqual([window.innerWidth, window.innerHeight], [300, 150]);
    iframe.width = '200';
    iframe.height = '100';
    assert.deepEqual([window.innerWidth, window.innerHeight], [200, 100]);
    assert.deepEqual([window.outerWidth, window.outerHeight], [200, 100]);
  });

  it('answers matchMedia by its own size, and tells a listener as that changes', async () => {
    // A chart in a frame lays itself out by the frame's width, not the page's.
    const document = await page();
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const narrow = iframe.contentWindow.matchMedia('(max-width: 250px)');
    assert.equal(narrow.matches, false, 'at 300 wide');
    const heard: boolean[] = [];
    narrow.addEventListener('change', (event: Dom) => heard.push(event.matches));
    iframe.width = '200';
    await settle();
    assert.equal(narrow.matches, true, 'at 200 wide');
    assert.deepEqual(heard, [true]);
  });

  it("tells a frame's matchMedia listener as the page's colour scheme changes", async () => {
    // The scheme and the motion are the page's, which the system changes under the frame.
    const document = await page();
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const dark = iframe.contentWindow.matchMedia('(prefers-color-scheme: dark)');
    const heard: boolean[] = [];
    dark.addEventListener('change', (event: Dom) => heard.push(event.matches));
    const engine = iframe.engine;
    engine.updateConditions({ width: 400, height: 800, colorScheme: 'light' });
    await settle();
    heard.length = 0;
    engine.updateConditions({ width: 400, height: 800, colorScheme: 'dark' });
    await settle();
    assert.equal(dark.matches, true);
    assert.deepEqual(heard, [true]);
    // And no more once the frame is closed: the engine keeps nothing of it to tell.
    iframe.remove();
    engine.updateConditions({ width: 400, height: 800, colorScheme: 'light' });
    await settle();
    assert.deepEqual(heard, [true], 'not told once the frame is closed');
  });

  it('closes a frame inside a frame that is taken out', async () => {
    const document = await page();
    const outer = document.createElement('iframe');
    document.body.appendChild(outer);
    const inner = outer.contentDocument.createElement('iframe');
    outer.contentDocument.body.appendChild(inner);
    const window = inner.contentWindow;
    assert.ok(window);
    assert.equal(window.parent, outer.contentWindow);
    assert.equal(window.top, globalThis);
    assert.equal(outer.contentWindow.length, 1);
    assert.equal(outer.contentWindow[0], window);
    outer.remove();
    assert.equal(window.closed, true);
  });

  it('has no window in a document no window shows', async () => {
    const document = await page();
    const made = document.implementation.createHTMLDocument('');
    const iframe = made.createElement('iframe');
    made.body.appendChild(iframe);
    assert.equal(iframe.contentDocument, null);
  });
});

describe('the page’s window', () => {
  it('is its own frames, parent and top, in no frame', async () => {
    await page();
    const globals = globalThis as Dom;
    assert.equal(globals.frames.document, globals.document);
    assert.equal(globals.frames.length, 0);
    const iframe = globals.document.createElement('iframe');
    globals.document.body.appendChild(iframe);
    assert.equal(globals.frames.length, 1);
    assert.equal(globals.frames[0], iframe.contentWindow);
    assert.equal(globals.parent, globals);
    assert.equal(globals.top, globals);
    assert.equal(globals.frameElement, null);
  });

  it('hears postMessage as a message', async () => {
    await page();
    const globals = globalThis as Dom;
    const heard: Dom[] = [];
    const listener = (event: Dom) => heard.push(event.data);
    globals.addEventListener('message', listener);
    try {
      globals.postMessage('hello', '*');
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.deepEqual(heard, ['hello']);
    } finally {
      globals.removeEventListener('message', listener);
    }
  });
});

describe("the engine's children", () => {
  const WATCHED = ['appendChild', 'insertBefore', 'removeChild'] as const;
  /** An engine as far as watching it goes: its methods its own, as a test's engine has them. */
  const engineWith = () =>
    ({
      appendChild() {},
      insertBefore() {},
      removeChild() {},
    }) as unknown as Engine;
  const iframe = { tag: 'iframe', nodeKind: 'element' } as unknown as EngineNode;

  it('are watched once an app that asked makes an iframe, and not after it is gone', () => {
    const engine = engineWith();
    const own = WATCHED.map((name) => engine[name]);
    const forgetMode = showFramesAs(engine, 'emulated');
    const forget = loadFramesWith(engine, undefined);
    frameCreated(iframe, engine);
    const watching = WATCHED.map((name) => engine[name]);
    assert.ok(watching.every((method, at) => method !== own[at]));
    // Made again: watched once.
    frameCreated(iframe, engine);
    assert.deepEqual(
      WATCHED.map((name) => engine[name]),
      watching,
    );
    forget();
    forgetMode();
    assert.deepEqual(
      WATCHED.map((name) => engine[name]),
      own,
    );
  });

  it('are left as another wrapped them after, and as the engine had them where none is its own', () => {
    const engine = engineWith();
    const forget = loadFramesWith(engine, undefined);
    const forgetMode = showFramesAs(engine, 'emulated');
    frameCreated(iframe, engine);
    const over = () => {};
    engine.appendChild = over;
    forget();
    forgetMode();
    assert.equal(engine.appendChild, over, 'not taken from under what wrapped it since');
    const shared = Object.create(engineWith()) as Engine;
    const forgetShared = loadFramesWith(shared, undefined);
    showFramesAs(shared, 'emulated');
    frameCreated(iframe, shared);
    forgetShared();
    assert.deepEqual(
      WATCHED.filter((name) => Object.hasOwn(shared, name)),
      [],
    );
  });

  it('are never watched in an app that did not ask', () => {
    const engine = engineWith();
    const own = WATCHED.map((name) => engine[name]);
    frameCreated(iframe, engine);
    assert.deepEqual(
      WATCHED.map((name) => engine[name]),
      own,
    );
  });
});
