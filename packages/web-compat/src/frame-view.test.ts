/**
 * `<iframe>` as a native web view: react-native-webview's `RNCWebView`, given what `src` or
 * `srcdoc` says, sized as a browser sizes a frame, and messaging the app's window both ways.
 * Where the view is absent, or the app asks for `frames: 'emulated'`, the emulated document.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, render, settle, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { provideWebCompat, type WebCompatOptions } from './index.ts';
import { framesHeard } from './frame-view.ts';

type Dom = any;

@Component({ selector: 'x-page', template: '' })
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

/** A frame whose template writes its attribute's name in capitals, which the renderer keeps. */
@Component({
  selector: 'x-capital-frame',
  template: '<iframe SRC="https://video.example/embed"></iframe>',
})
class CapitalFrame {
  readonly document: Dom = inject(DOCUMENT);
}

type Host = Record<string, unknown>;
const host = globalThis as Host;
const NAMES = [
  '__nativeComponentRegistry__hasComponent',
  'nativeModuleProxy',
  'RN$registerCallableModule',
] as const;
let saved: Record<string, PropertyDescriptor | undefined> = {};
let decisions: [boolean, number][] = [];
/** Registered once for the process, as the library's own module is. */
let callable: Record<string, (event: unknown) => void> | undefined;
let warnings: string[] = [];
let warn: typeof console.warn;

/** What React Native answers on a device with react-native-webview installed. */
function installWebView(): void {
  host['__nativeComponentRegistry__hasComponent'] = (name: string) => name === 'RNCWebView';
  host['nativeModuleProxy'] = {
    RNCWebViewModule: {
      shouldStartLoadWithLockIdentifier: (start: boolean, lock: number) =>
        decisions.push([start, lock]),
    },
  };
  host['RN$registerCallableModule'] = (name: string, factory: () => typeof callable) => {
    if (name === 'RNCWebViewMessagingModule') callable = factory();
  };
}

beforeEach(() => {
  saved = Object.fromEntries(
    NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(host, name)]),
  );
  decisions = [];
  warnings = [];
  warn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '));
});

afterEach(() => {
  try {
    cleanup();
  } finally {
    console.warn = warn;
    for (const name of NAMES) {
      const descriptor = saved[name];
      if (descriptor) Object.defineProperty(host, name, descriptor);
      else delete host[name];
    }
  }
});

async function page(
  options: WebCompatOptions = {},
): Promise<{ document: Dom; fabric: FakeFabric }> {
  const providers = [provideWebCompat({ url: 'https://shop.example/orders/', ...options })];
  const app = await render(Page, { providers });
  await settle();
  return { document: app.fixture.componentInstance.document, fabric: app.fabric };
}

/** An iframe put in the page with these attributes, once it is committed. */
async function framed(document: Dom, attributes: Record<string, string> = {}): Promise<Dom> {
  const iframe = document.createElement('iframe');
  for (const [name, value] of Object.entries(attributes)) iframe.setAttribute(name, value);
  document.body.appendChild(iframe);
  await settle();
  return iframe;
}

const view = (fabric: FakeFabric): FakeFabricNode => {
  const found = fabric.find('RNCWebView');
  assert.ok(found, fabric.render());
  return found;
};

/** What the app has posted into the page in its frames. */
const sent = (fabric: FakeFabric) =>
  fabric.commands.filter((each) => each.name === 'injectJavaScript');

/** The `message` events the app's window hears from what a function does. */
async function heard(send: () => void): Promise<Dom[]> {
  const messages: Dom[] = [];
  const listener = (event: Dom) => messages.push(event);
  globalThis.addEventListener('message', listener);
  try {
    send();
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    globalThis.removeEventListener('message', listener);
  }
  return messages;
}

/** Collect what nothing holds, as a long-running app's runtime does in time. */
async function collectGarbage(): Promise<void> {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  // A `WeakRef` holds what it refers to until the job that read it is over.
  await new Promise((resolve) => setTimeout(resolve, 0));
  gc();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('iframe as a web view', () => {
  it('commits as RNCWebView, showing src resolved against the page address', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, { src: 'embed/7?autoplay=1' });
    const props = view(fabric).props;
    assert.equal(
      (props['newSource'] as { uri: string }).uri,
      'https://shop.example/orders/embed/7?autoplay=1',
    );
    assert.equal(props['messagingEnabled'], true);
    assert.equal(typeof props['injectedJavaScriptBeforeContentLoaded'], 'string');
    // What src says stays the attribute, as written.
    assert.equal(iframe.getAttribute('src'), 'embed/7?autoplay=1');
  });

  it('sends the page as the referrer, as a browser does by its referrer policy', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, { src: 'https://video.example/embed' });
    const referrer = () =>
      (view(fabric).props['newSource'] as { headers?: { name: string; value: string }[] }).headers;
    // Another origin is told the page's origin, and the page's own its whole address.
    assert.deepEqual(referrer(), [{ name: 'Referer', value: 'https://shop.example/' }]);
    iframe.setAttribute('src', 'next.html');
    await settle();
    assert.deepEqual(referrer(), [{ name: 'Referer', value: 'https://shop.example/orders/' }]);
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    await settle();
    assert.equal(referrer(), undefined);
    iframe.setAttribute('referrerpolicy', 'unsafe-url');
    iframe.setAttribute('src', 'https://video.example/embed');
    await settle();
    assert.deepEqual(referrer(), [{ name: 'Referer', value: 'https://shop.example/orders/' }]);
  });

  it('shows srcdoc as HTML with the page as its base, and about:blank as an empty page', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, { srcdoc: '<p>Hello</p>', src: 'ignored.html' });
    assert.deepEqual(view(fabric).props['newSource'], {
      html: '<p>Hello</p>',
      baseUrl: 'https://shop.example/orders/',
    });
    iframe.removeAttribute('srcdoc');
    iframe.removeAttribute('src');
    await settle();
    assert.deepEqual(view(fabric).props['newSource'], { html: '' });
    iframe.setAttribute('src', 'next.html');
    await settle();
    assert.equal(
      (view(fabric).props['newSource'] as { uri: string }).uri,
      'https://shop.example/orders/next.html',
    );
  });

  it('is 300 by 150 as a browser has it, or the size its width and height say', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document);
    // Committed flattened, as React Native's own style is.
    const style = () => view(fabric).props;
    assert.equal(style()['width'], 300);
    assert.equal(style()['height'], 150);
    iframe.setAttribute('width', '560');
    iframe.setAttribute('height', '50%');
    await settle();
    assert.equal(style()['width'], 560);
    assert.equal(style()['height'], '50%');
    // Read back as written, though the view is sized by them and has no such prop, a copy too.
    assert.equal(iframe.getAttribute('width'), '560');
    assert.equal(iframe.cloneNode().getAttribute('width'), '560');
    assert.equal(iframe.width, '560');
    assert.ok(iframe.getAttributeNames().includes('height'));
    iframe.removeAttribute('width');
    await settle();
    assert.equal(style()['width'], 300);
    assert.equal(iframe.getAttribute('width'), null);
    assert.equal(iframe.hasAttribute('width'), false);
    assert.equal(iframe.getAttributeNames().includes('width'), false);
  });

  it('hears load as the page in it finishes loading, and has no document to read', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, { src: 'https://video.example/embed' });
    let loads = 0;
    iframe.addEventListener('load', () => loads++);
    fabric.emit(view(fabric), 'topLoadingFinish', { url: 'https://video.example/embed' });
    assert.equal(loads, 1);
    assert.equal(iframe.contentDocument, null);
    assert.ok(iframe.contentWindow);
    assert.equal(iframe.contentWindow, iframe.contentWindow);
    assert.equal(iframe.contentWindow.parent, globalThis);
  });

  it('lets every navigation go ahead where the platform waits to be told', async () => {
    installWebView();
    const { document, fabric } = await page();
    await framed(document, { src: 'https://video.example/embed' });
    fabric.emit(view(fabric), 'topShouldStartLoadWithRequest', { url: 'x', lockIdentifier: 4 });
    assert.deepEqual(decisions, [[true, 4]]);
  });

  it('posts a message into the page, to the origin it is from', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, { src: 'https://video.example/embed' });
    fabric.emit(view(fabric), 'topLoadingFinish', { url: 'https://video.example/embed' });
    const sent = () => fabric.commands.filter((each) => each.name === 'injectJavaScript');
    iframe.contentWindow.postMessage({ play: true }, 'https://other.example');
    assert.equal(sent().length, 0);
    iframe.contentWindow.postMessage({ play: true }, 'https://video.example');
    assert.equal(sent().length, 1);
    // Run as the page would, where it hears a message event from its parent.
    const heard: Dom[] = [];
    const window: Dom = {
      parent: { stub: true },
      location: { origin: 'https://video.example' },
      dispatchEvent: (event: Dom) => heard.push(event),
    };
    const run = (script: unknown) =>
      runInNewContext(String(script), {
        window,
        MessageEvent: class {
          type: string;
          constructor(type: string, init: { source?: unknown }) {
            // A browser takes no source but a window or a port, which the page's parent is not.
            if (init.source != null) throw new TypeError('source is not a Window or a MessagePort');
            this.type = type;
            Object.assign(this, init);
          }
        },
      });
    // A page that has gone to another origin since it last said where it is hears nothing.
    window.location.origin = 'https://elsewhere.example';
    run(sent()[0]!.args[0]);
    assert.equal(heard.length, 0);
    window.location.origin = 'https://video.example';
    run(sent()[0]!.args[0]);
    assert.equal(heard.length, 1);
    assert.equal(heard[0].type, 'message');
    // Made in the page's realm, so compared by what it holds.
    assert.deepEqual(JSON.parse(JSON.stringify(heard[0].data)), { play: true });
    assert.equal(heard[0].origin, 'https://shop.example');
    assert.equal(heard[0].source, window.parent);
  });

  it('hears a message the page posts to its parent, from the frame and its origin', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, { src: 'https://video.example/embed' });
    const node = view(fabric);
    // The page's own script, as the web view runs it before the page's.
    const posted: string[] = [];
    const inner: Dom = { ReactNativeWebView: { postMessage: (data: string) => posted.push(data) } };
    inner.window = inner;
    inner.parent = inner;
    inner.location = { origin: 'https://video.example' };
    runInNewContext(String(node.props['injectedJavaScriptBeforeContentLoaded']), {
      window: inner,
      JSON,
      Object,
    });
    assert.notEqual(inner.parent, inner);
    inner.parent.postMessage({ state: 'playing' }, '*');
    assert.equal(posted.length, 1);
    const messages: Dom[] = [];
    const listener = (event: Dom) => messages.push(event);
    globalThis.addEventListener('message', listener);
    try {
      fabric.emit(node, 'topMessage', { url: 'https://video.example/embed', data: posted[0] });
      await new Promise((resolve) => setTimeout(resolve, 0));
      // What the page sent by the bridge itself is heard as the string it is.
      fabric.emit(node, 'topMessage', { url: 'https://video.example/embed', data: 'raw' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      globalThis.removeEventListener('message', listener);
    }
    assert.equal(messages.length, 2);
    assert.deepEqual(messages[0].data, { state: 'playing' });
    assert.equal(messages[0].origin, 'https://video.example');
    assert.equal(messages[0].source, iframe.contentWindow);
    assert.equal(messages[1].data, 'raw');
  });

  it('drops a message the page posts to an origin that is not the app’s', async () => {
    installWebView();
    const { document, fabric } = await page();
    await framed(document, { src: 'https://video.example/embed' });
    const node = view(fabric);
    const posted: string[] = [];
    const inner: Dom = { ReactNativeWebView: { postMessage: (data: string) => posted.push(data) } };
    inner.window = inner;
    inner.parent = inner;
    runInNewContext(String(node.props['injectedJavaScriptBeforeContentLoaded']), {
      window: inner,
      JSON,
      Object,
    });
    inner.parent.postMessage('secret', 'https://elsewhere.example');
    const messages: Dom[] = [];
    const listener = (event: Dom) => messages.push(event);
    globalThis.addEventListener('message', listener);
    try {
      fabric.emit(node, 'topMessage', { url: 'https://video.example/embed', data: posted[0] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      globalThis.removeEventListener('message', listener);
    }
    assert.equal(messages.length, 0);
  });

  it('hears Android’s messages and navigations, which come by a module of their own', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, { srcdoc: '<p>Hi</p>' });
    const name = view(fabric).props['messagingModuleName'];
    assert.equal(typeof name, 'string');
    assert.ok(callable, 'RNCWebViewMessagingModule is registered');
    callable!['onShouldStartLoadWithRequest']!({
      messagingModuleName: name,
      nativeEvent: { url: 'about:srcdoc', lockIdentifier: 9 },
    });
    assert.deepEqual(decisions, [[true, 9]]);
    const messages: Dom[] = [];
    const listener = (event: Dom) => messages.push(event);
    globalThis.addEventListener('message', listener);
    try {
      callable!['onMessage']!({ messagingModuleName: `${name}x`, nativeEvent: { data: 'no' } });
      callable!['onMessage']!({ messagingModuleName: name, nativeEvent: { data: 'yes' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      globalThis.removeEventListener('message', listener);
    }
    assert.deepEqual(
      messages.map((each) => each.data),
      ['yes'],
    );
    // A srcdoc frame is the page's own origin.
    assert.equal(messages[0].origin, 'https://shop.example');
    assert.equal(messages[0].source, iframe.contentWindow);
  });

  it("posts to an origin at the app's own scheme, and throws for one that is no URL", async () => {
    installWebView();
    const { document, fabric } = await page({ url: 'exp://127.0.0.1:8081/--/' });
    const iframe = await framed(document, { srcdoc: '<p>Hi</p>' });
    const sent = () => fabric.commands.filter((each) => each.name === 'injectJavaScript');
    // Expo Go's address, whose origin the page reads as its scheme and host.
    iframe.contentWindow.postMessage('hello', 'exp://127.0.0.1:8081');
    assert.equal(sent().length, 1);
    assert.throws(
      () => iframe.contentWindow.postMessage('hello', 'not a url'),
      (error: Dom) => error.name === 'SyntaxError',
    );
  });

  it('sends nothing for the app to a page of another origin that is still loading', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, { src: 'https://video.example/embed' });
    const sent = () => fabric.commands.filter((each) => each.name === 'injectJavaScript');
    // Before it has loaded, the frame is at the page it is going to, not the app's.
    iframe.contentWindow.postMessage('secret', '/');
    assert.equal(sent().length, 0);
    iframe.contentWindow.postMessage('hello', 'https://video.example');
    assert.equal(sent().length, 1);
  });

  it('delivers what is for the app to what srcdoc holds, and not to the page it replaces', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, { srcdoc: '<p>Hi</p>' });
    const sent = () => fabric.commands.filter((each) => each.name === 'injectJavaScript');
    iframe.contentWindow.postMessage('secret', '/');
    assert.equal(sent().length, 1);
    const heard: Dom[] = [];
    const deliverAt = (location: { origin: string; protocol: string }) =>
      runInNewContext(String(sent()[0]!.args[0]), {
        window: { parent: {}, location, dispatchEvent: (event: Dom) => heard.push(event) },
        MessageEvent: class {
          constructor(type: string, init: object) {
            Object.assign(this, { type }, init);
          }
        },
      });
    // The page of another site the frame showed, until what srcdoc holds has loaded.
    deliverAt({ origin: 'https://video.example', protocol: 'https:' });
    assert.equal(heard.length, 0);
    // What srcdoc holds, with no web origin, as Android loads it.
    deliverAt({ origin: 'null', protocol: 'about:' });
    assert.equal(heard.length, 1);
  });

  it("gives a srcdoc frame that goes to a web address that address's origin", async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, {
      srcdoc: '<a href="https://elsewhere.example/">Go</a>',
    });
    fabric.emit(view(fabric), 'topLoadingFinish', { url: 'https://elsewhere.example/' });
    const sent = () => fabric.commands.filter((each) => each.name === 'injectJavaScript');
    // What is for the app's own origin is not sent to a page that has left it.
    iframe.contentWindow.postMessage('secret', 'https://shop.example');
    assert.equal(sent().length, 0);
    iframe.contentWindow.postMessage('hello', 'https://elsewhere.example');
    assert.equal(sent().length, 1);
  });

  it('gives a srcdoc frame that goes to a data: URL no origin', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, { srcdoc: '<a href="data:text/html,x">Go</a>' });
    fabric.emit(view(fabric), 'topLoadingFinish', { url: 'data:text/html,x' });
    iframe.contentWindow.postMessage('secret', 'https://shop.example');
    iframe.contentWindow.postMessage('secret', '/');
    assert.equal(sent(fabric).length, 0);
  });

  it('drops a message the page sends as null, and hears the next', async () => {
    installWebView();
    const { document, fabric } = await page();
    await framed(document, { srcdoc: '<p>Hi</p>' });
    const messagingModuleName = view(fabric).props['messagingModuleName'];
    // Android's module calls in with nothing between it and the listener to catch what throws.
    const messages = await heard(() => {
      callable!['onMessage']!({
        messagingModuleName,
        nativeEvent: { url: 'about:srcdoc', data: 'ng-native:frame-message:null' },
      });
      callable!['onMessage']!({ messagingModuleName, nativeEvent: { data: 'hi' } });
    });
    assert.deepEqual(
      messages.map((each) => each.data),
      ['hi'],
    );
  });

  it('is the app’s origin again once srcdoc replaces a page that loaded', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, { src: 'https://video.example/embed' });
    fabric.emit(view(fabric), 'topLoadingFinish', { url: 'https://video.example/embed' });
    iframe.setAttribute('srcdoc', '<p>Hi</p>');
    await settle();
    const messages = await heard(() =>
      fabric.emit(view(fabric), 'topMessage', { url: 'about:srcdoc', data: 'hi' }),
    );
    assert.deepEqual(
      messages.map((each) => each.origin),
      ['https://shop.example'],
    );
    iframe.contentWindow.postMessage('hello', '/');
    assert.equal(sent(fabric).length, 1);
  });

  it('takes where a message says it is from for that message, and not for the frame', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, { src: 'https://video.example/embed' });
    fabric.emit(view(fabric), 'topLoadingFinish', { url: 'https://video.example/embed' });
    // Android says the frame in the page a message is from: here, an advert's.
    const messages = await heard(() => {
      fabric.emit(view(fabric), 'topMessage', { url: 'https://ads.example/slot', data: 'ad' });
      fabric.emit(view(fabric), 'topMessage', { url: 'https://video.example/embed', data: 'hi' });
    });
    assert.deepEqual(
      messages.map((each) => each.origin),
      ['https://ads.example', 'https://video.example'],
    );
    fabric.emit(view(fabric), 'topMessage', { url: 'https://ads.example/slot', data: 'ad' });
    iframe.contentWindow.postMessage('hello', 'https://video.example');
    assert.equal(sent(fabric).length, 1);
  });

  it('gives a sandbox without allow-same-origin no origin, as the attribute changes', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, { sandbox: 'allow-scripts', srcdoc: '<p>Hi</p>' });
    const origins = async () =>
      (
        await heard(() =>
          fabric.emit(view(fabric), 'topMessage', { url: 'about:srcdoc', data: 'x' }),
        )
      ).map((each) => each.origin);
    // No base of the app's to load from, nothing for the app's origin, and heard from none.
    assert.deepEqual(view(fabric).props['newSource'], { html: '<p>Hi</p>' });
    iframe.contentWindow.postMessage('secret', '/');
    iframe.contentWindow.postMessage('secret', 'https://shop.example');
    assert.equal(sent(fabric).length, 0);
    iframe.contentWindow.postMessage('anyone', '*');
    assert.equal(sent(fabric).length, 1);
    assert.deepEqual(await origins(), ['null']);
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    await settle();
    assert.deepEqual(view(fabric).props['newSource'], {
      html: '<p>Hi</p>',
      baseUrl: 'https://shop.example/orders/',
    });
    iframe.contentWindow.postMessage('secret', '/');
    assert.equal(sent(fabric).length, 2);
    assert.deepEqual(await origins(), ['https://shop.example']);
    iframe.setAttribute('sandbox', 'allow-scripts');
    await settle();
    assert.deepEqual(await origins(), ['null']);
    assert.deepEqual(view(fabric).props['newSource'], { html: '<p>Hi</p>' });
    iframe.removeAttribute('sandbox');
    await settle();
    assert.deepEqual(await origins(), ['https://shop.example']);
    assert.equal(
      (view(fabric).props['newSource'] as { baseUrl?: string }).baseUrl,
      'https://shop.example/orders/',
    );
  });

  it('runs no script in a sandbox that does not allow scripts, and says what it leaves out', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, { sandbox: 'allow-forms', loading: 'lazy' });
    assert.equal(view(fabric).props['javaScriptEnabled'], false);
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    await settle();
    assert.equal(view(fabric).props['javaScriptEnabled'], true);
    iframe.setAttribute('loading', 'eager');
    assert.equal(warnings.filter((each) => each.includes('loading=')).length, 1);
    assert.equal(view(fabric).props['loading'], undefined);
  });

  it('says a src page in a sandbox without allow-same-origin keeps its own origin', async () => {
    installWebView();
    const { document } = await page();
    await framed(document, { sandbox: 'allow-scripts', srcdoc: '<p>Hi</p>' });
    assert.equal(warnings.filter((each) => each.includes('its own origin')).length, 0);
    await framed(document, { sandbox: 'allow-scripts', src: 'https://video.example/embed' });
    assert.equal(warnings.filter((each) => each.includes('its own origin')).length, 1);
  });

  it('allows fullscreen while allow lists it or allowfullscreen is there', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, { allow: 'fullscreen', allowfullscreen: '' });
    const fullscreen = () => view(fabric).props['allowsFullscreenVideo'];
    assert.equal(fullscreen(), true);
    iframe.removeAttribute('allowfullscreen');
    await settle();
    assert.equal(fullscreen(), true, 'allow still lists it');
    iframe.setAttribute('allow', 'autoplay');
    await settle();
    assert.equal(fullscreen(), false);
  });

  it("allows no feature whose allowlist is 'none'", async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, {
      allow: "autoplay 'none'; picture-in-picture 'none'; fullscreen 'none'",
    });
    const props = () => view(fabric).props;
    assert.equal(props()['mediaPlaybackRequiresUserAction'], true);
    assert.equal(props()['allowsPictureInPictureMediaPlayback'], false);
    assert.equal(props()['allowsFullscreenVideo'], false);
    iframe.setAttribute('allow', "autoplay 'self'; picture-in-picture *");
    await settle();
    assert.equal(props()['mediaPlaybackRequiresUserAction'], false);
    assert.equal(props()['allowsPictureInPictureMediaPlayback'], true);
  });

  it('sends no name, password or fragment of the page as the referrer, by any policy', async () => {
    installWebView();
    const { document, fabric } = await page({ url: 'https://me:secret@shop.example/orders/#paid' });
    const iframe = await framed(document, { src: 'next.html', referrerpolicy: 'unsafe-url' });
    const referrer = () =>
      (view(fabric).props['newSource'] as { headers?: { value: string }[] }).headers?.[0]?.value;
    assert.equal(referrer(), 'https://shop.example/orders/');
    // A policy no browser has is the default, and not one of every object's members.
    iframe.setAttribute('referrerpolicy', 'constructor');
    iframe.setAttribute('src', 'https://video.example/embed');
    await settle();
    assert.equal(referrer(), 'https://shop.example/');
  });

  it('is at where src says again once srcdoc is taken away', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, {
      src: 'https://video.example/embed',
      srcdoc: '<p>Hi</p>',
    });
    iframe.removeAttribute('srcdoc');
    await settle();
    iframe.contentWindow.postMessage('secret', 'https://shop.example');
    assert.equal(sent(fabric).length, 0);
    iframe.contentWindow.postMessage('hello', 'https://video.example');
    assert.equal(sent(fabric).length, 1);
  });

  it('takes an attribute a template writes in capitals by its name', async () => {
    installWebView();
    const app = await render(CapitalFrame, {
      providers: [provideWebCompat({ url: 'https://shop.example/' })],
    });
    await settle();
    const iframe = app.fixture.componentInstance.document.querySelector('iframe');
    assert.equal(iframe.getAttribute('src'), 'https://video.example/embed');
  });

  it('shows a copy of an iframe as the iframe it is a copy of', async () => {
    installWebView();
    const { document, fabric } = await page();
    const iframe = await framed(document, { width: '560', src: 'https://video.example/embed' });
    const copy = iframe.cloneNode();
    iframe.remove();
    document.body.appendChild(copy);
    await settle();
    assert.equal(view(fabric).props['width'], 560);
    fabric.emit(view(fabric), 'topLoadingFinish', { url: 'https://video.example/embed' });
    copy.contentWindow.postMessage('hello', 'https://video.example');
    assert.equal(sent(fabric).length, 1);
  });

  it('is the emulated document where the app asks for it', async () => {
    installWebView();
    const { document, fabric } = await page({ frames: 'emulated' });
    const iframe = await framed(document, { srcdoc: '<p id="here">Hi</p>' });
    assert.equal(fabric.find('RNCWebView'), undefined);
    assert.ok(iframe.contentDocument);
  });

  it('is the emulated document, said nothing of, where there is no React Native to ask', async () => {
    // Node, and the web host: no component registry at all.
    delete host['__nativeComponentRegistry__hasComponent'];
    const { document, fabric } = await page();
    const iframe = await framed(document, { srcdoc: '<p>Hi</p>' });
    assert.equal(fabric.find('RNCWebView'), undefined);
    assert.ok(iframe.contentDocument);
    assert.deepEqual(warnings, []);
  });

  it('lets a navigation go where the web view module is not there to tell', async () => {
    installWebView();
    delete host['nativeModuleProxy'];
    const { document, fabric } = await page();
    await framed(document, { src: 'https://video.example/embed' });
    fabric.emit(view(fabric), 'topShouldStartLoadWithRequest', { url: 'x', lockIdentifier: 4 });
    host['nativeModuleProxy'] = { RNCWebViewModule: {} };
    fabric.emit(view(fabric), 'topShouldStartLoadWithRequest', { url: 'x', lockIdentifier: 5 });
    assert.deepEqual(decisions, []);
  });

  it('hears no message for a frame of an app that is gone', async () => {
    installWebView();
    const { document, fabric } = await page();
    await framed(document, { srcdoc: '<p>Hi</p>' });
    const name = view(fabric).props['messagingModuleName'];
    cleanup();
    await page();
    const messages: Dom[] = [];
    const listener = (event: Dom) => messages.push(event);
    globalThis.addEventListener('message', listener);
    try {
      callable!['onMessage']!({ messagingModuleName: name, nativeEvent: { data: 'late' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      globalThis.removeEventListener('message', listener);
    }
    assert.deepEqual(messages, []);
  });

  it('forgets the name of a frame that is gone, while its app is still up', async () => {
    installWebView();
    const { document } = await page();
    const before = framesHeard();
    // Made and taken out in a scope of its own, so nothing here holds it after.
    await (async () => (await framed(document)).remove())();
    await settle();
    await collectGarbage();
    await framed(document);
    assert.equal(framesHeard(), before + 1);
  });

  it('is the emulated document where react-native-webview is not installed, said once', async () => {
    host['__nativeComponentRegistry__hasComponent'] = () => false;
    const { document, fabric } = await page();
    const iframe = await framed(document);
    await framed(document);
    assert.equal(fabric.find('RNCWebView'), undefined);
    assert.ok(iframe.contentDocument);
    assert.equal(warnings.filter((each) => each.includes('react-native-webview')).length, 1);
  });
});
