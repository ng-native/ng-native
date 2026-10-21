/**
 * The page's address: the app's own URL, as a browser has the address of the page it shows. What
 * `document.URL`, `baseURI` and `window.location` say, what a relative link resolves against,
 * and how `location.assign` is followed.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { Location, PlatformLocation } from '@angular/common';
import { cleanup, render, settle } from '@ng-native/testing';
import { DeepLinks, type DeepLinkSource } from '@ng-native/device';
import { provideWebCompat } from './index.ts';
import { StillLocation } from './location.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({ selector: 'x-page', template: '<a id="link" href="docs/a?q=1#top">Docs</a>' })
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

async function page(providers: unknown[] = [provideWebCompat({ url: 'https://shop.example/' })]) {
  const app = await render(Page, { providers: providers as never });
  await settle();
  const document: Dom = app.fixture.componentInstance.document;
  return { app, document };
}

/** Run with `globalThis.expo` as Expo's modules have it, put back after. */
async function withExpo<T>(constants: object | undefined, run: () => Promise<T>): Promise<T> {
  const scope = globalThis as { expo?: unknown };
  const had = 'expo' in scope;
  const before = scope.expo;
  scope.expo = constants && { modules: { ExponentConstants: constants } };
  try {
    return await run();
  } finally {
    if (had) scope.expo = before;
    else delete scope.expo;
  }
}

describe("the page's address", () => {
  it('is the address the app gives, with the route on it', async () => {
    const { document } = await page();
    assert.equal(document.URL, 'https://shop.example/');
    assert.equal(document.documentURI, 'https://shop.example/');
    assert.equal(document.baseURI, 'https://shop.example/');
    assert.equal(document.body.baseURI, 'https://shop.example/');
    assert.equal(document.location, (globalThis as Dom).location);
  });

  it('is the deep link Expo Go opens the app with', async () => {
    await withExpo({ linkingUri: 'exp://127.0.0.1:8082/--/' }, async () => {
      const { document } = await page([provideWebCompat()]);
      assert.equal(document.URL, 'exp://127.0.0.1:8082/--/');
    });
  });

  it("is the app config's scheme in a build, as iOS and Android hand the config", async () => {
    await withExpo({ manifest: { scheme: 'canary' } }, async () => {
      const { document } = await page([provideWebCompat()]);
      assert.equal(document.URL, 'canary:///');
    });
    await cleanup();
    await withExpo({ manifest: JSON.stringify({ scheme: ['shop', 'other'] }) }, async () => {
      const { document } = await page([provideWebCompat()]);
      assert.equal(document.URL, 'shop:///');
    });
  });

  it('is under app: with nothing to ask, and with a config that cannot be read', async () => {
    const { document } = await page([provideWebCompat()]);
    assert.equal(document.URL, 'app:///');
    await cleanup();
    await withExpo({ manifest: '{not json' }, async () => {
      const { document: again } = await page([provideWebCompat()]);
      assert.equal(again.URL, 'app:///');
    });
  });

  it('is the one the app gives over the one Expo has', async () => {
    await withExpo({ linkingUri: 'exp://127.0.0.1:8082/--/' }, async () => {
      const { document } = await page([provideWebCompat({ url: 'https://shop.example' })]);
      assert.equal(document.URL, 'https://shop.example/');
    });
  });

  it('follows the route as the app navigates', async () => {
    // A history whose route moves, as the router's does on a navigation.
    const history = new StillLocation();
    const { document } = await page([
      provideWebCompat({ url: 'exp://127.0.0.1:8082/--/' }),
      { provide: PlatformLocation, useValue: history },
    ]);
    Object.assign(history, { pathname: '/orders/7', search: '?tab=2', hash: '#paid' });
    assert.equal(document.URL, 'exp://127.0.0.1:8082/--/orders/7?tab=2#paid');
    const location: Dom = (globalThis as Dom).location;
    assert.equal(location.href, 'exp://127.0.0.1:8082/--/orders/7?tab=2#paid');
    assert.equal(location.pathname, '/--/orders/7');
    assert.equal(location.search, '?tab=2');
    assert.equal(location.hash, '#paid');
    assert.equal(location.host, '127.0.0.1:8082');
    assert.equal(location.hostname, '127.0.0.1');
    assert.equal(location.port, '8082');
    assert.equal(location.protocol, 'exp:');
    assert.equal(location.origin, 'exp://127.0.0.1:8082');
    assert.equal(String(location), location.href);
    assert.equal(new URL('../receipt', location.href).href, 'exp://127.0.0.1:8082/--/receipt');
  });

  it('puts the route on the path of an address the app gives with a query or a fragment', async () => {
    const history = new StillLocation();
    const { document } = await page([
      provideWebCompat({ url: 'https://shop.example/app/?x=1#top' }),
      { provide: PlatformLocation, useValue: history },
    ]);
    Object.assign(history, { pathname: '/orders', search: '?tab=2' });
    assert.equal(document.URL, 'https://shop.example/app/orders?tab=2');
  });

  it('takes one / off an address the app gives that ends in //, past its scheme', async () => {
    const history = new StillLocation();
    const { document } = await page([
      provideWebCompat({ url: 'https://shop.example/app//' }),
      { provide: PlatformLocation, useValue: history },
    ]);
    Object.assign(history, { pathname: '/orders' });
    assert.equal(document.URL, 'https://shop.example/app//orders');
  });
});

describe("Angular's Location", () => {
  it('stands on a history of its own in an app with no router', async () => {
    const { app } = await page();
    const location = app.componentRef.injector.get(Location);
    assert.equal(location.path(), '');
    location.go('/orders');
    location.back();
    assert.equal((globalThis as Dom).location.href, 'https://shop.example/');
  });

  it("reads the page's address from a history that reads window.location itself", async () => {
    const history = {
      get pathname() {
        return (globalThis as Dom).location.pathname + 'orders';
      },
      search: '',
      hash: '',
    };
    const { document } = await page([
      provideWebCompat({ url: 'https://shop.example/' }),
      { provide: PlatformLocation, useValue: history },
    ]);
    assert.equal(document.URL, 'https://shop.example/orders');
  });
});

describe('what resolves against it', () => {
  it('resolves a relative link, and its parts', async () => {
    const { document } = await page();
    const link = document.getElementById('link');
    assert.equal(link.href, 'https://shop.example/docs/a?q=1#top');
    assert.equal(link.pathname, '/docs/a');
    assert.equal(link.host, 'shop.example');
    assert.equal(link.origin, 'https://shop.example');
    link.pathname = '/b';
    assert.equal(link.getAttribute('href'), 'https://shop.example/b?q=1#top');
  });

  it('resolves the URL an attribute of another element says', async () => {
    const { document } = await page();
    const image = document.createElement('img');
    assert.equal(image.src, '', 'none written');
    image.setAttribute('src', 'logo.png');
    assert.equal(image.src, 'https://shop.example/logo.png');
    image.setAttribute('src', 'http://[bad');
    assert.equal(image.src, 'http://[bad', 'what is no URL reads as written');
    const quote = document.createElement('blockquote');
    quote.setAttribute('cite', '/sources/1');
    assert.equal(quote.cite, 'https://shop.example/sources/1');
    const form = document.createElement('form');
    assert.equal(form.action, 'https://shop.example/', "with none, the page's own");
    form.setAttribute('action', 'send');
    assert.equal(form.action, 'https://shop.example/send');
  });

  it('resolves against a <base href> in the head, while it is there', async () => {
    const { document } = await page();
    const base = document.createElement('base');
    base.setAttribute('href', '/shop/');
    document.head.appendChild(base);
    assert.equal(document.baseURI, 'https://shop.example/shop/');
    assert.equal(base.href, 'https://shop.example/shop/');
    assert.equal(document.getElementById('link').href, 'https://shop.example/shop/docs/a?q=1#top');
    base.setAttribute('href', 'https://cdn.example/');
    assert.equal(document.baseURI, 'https://cdn.example/');
    document.head.removeChild(base);
    assert.equal(document.baseURI, 'https://shop.example/');
  });

  it('resolves against the first <base> with an href, past one without', async () => {
    const { document } = await page();
    const target = document.createElement('base');
    target.setAttribute('target', '_top');
    const base = document.createElement('base');
    base.setAttribute('href', '/shop/');
    document.head.append(target, base);
    assert.equal(document.baseURI, 'https://shop.example/shop/');
  });

  it('is what a link is as a string', async () => {
    const { document } = await page();
    const link = document.getElementById('link');
    assert.equal(String(link), 'https://shop.example/docs/a?q=1#top');
    assert.equal(`${document.createElement('area')}`, '');
    assert.equal(String(document.createElement('div')), '[object Object]');
  });

  it('leaves a document a script made at about:blank', async () => {
    const { document } = await page();
    const made = document.implementation.createHTMLDocument('');
    assert.equal(made.URL, 'about:blank');
    assert.equal(made.baseURI, 'about:blank');
    const link = made.createElement('a');
    made.body.appendChild(link);
    link.setAttribute('href', 'docs/a');
    assert.equal(link.href, 'docs/a', 'nothing to resolve against');
  });

  it("resolves where the runtime's URL cannot, as React Native's cannot", async () => {
    const { document } = await page([provideWebCompat({ url: 'canary://' })]);
    const real = globalThis.URL;
    // React Native's: a base that is not http is refused, and the parts are read for http only.
    class NativeUrl {
      readonly href: string;
      constructor(url: string, base?: string) {
        if (base !== undefined && !/^https?:/.test(base)) throw new TypeError('Invalid base URL');
        this.href = url;
      }
      get pathname() {
        return '/';
      }
    }
    globalThis.URL = NativeUrl as never;
    try {
      const link = document.getElementById('link');
      assert.equal(link.href, 'canary:///docs/a?q=1#top');
      assert.equal(link.pathname, '/docs/a');
      assert.equal(link.search, '?q=1');
      assert.equal(link.protocol, 'canary:');
      link.hash = 'end';
      assert.equal(link.getAttribute('href'), 'canary:///docs/a?q=1#end');
      link.setAttribute('href', '../../x/./y/../z');
      assert.equal(link.href, 'canary:///x/z');
      link.setAttribute('href', 'https://User@Site.Example:443/a/../b?c');
      assert.equal(link.href, 'https://User@site.example/b?c');
      assert.equal(link.origin, 'https://site.example');
      assert.equal((globalThis as Dom).location.pathname, '/');
    } finally {
      globalThis.URL = real;
    }
    const link = document.getElementById('link');
    link.setAttribute('href', '../../x/./y/../z');
    assert.equal(link.href, 'canary:///x/z', 'back on the real one');
  });
});

describe('window.location', () => {
  it('follows a link into the app, and opens one out of it', async () => {
    const opened: string[] = [];
    const source: DeepLinkSource = {
      launchUrl: () => Promise.resolve(null),
      subscribe: () => () => {},
      open: (url) => void opened.push(url),
    };
    const { app } = await page([
      provideWebCompat({ url: 'https://shop.example/' }),
      { provide: DeepLinks.SOURCE, useValue: source },
    ]);
    const followed: string[] = [];
    const stop = app.componentRef.injector.get(DeepLinks).subscribe((path) => followed.push(path));
    const location: Dom = (globalThis as Dom).location;
    location.assign('/orders?open=1');
    location.replace('https://shop.example/cart#top');
    location.href = 'help';
    location.pathname = '/search';
    location.assign('https://elsewhere.example/a');
    location.reload();
    stop();
    assert.deepEqual(followed, ['/orders?open=1', '/cart#top', '/help', '/search']);
    assert.deepEqual(opened, ['https://elsewhere.example/a']);
    assert.throws(() => location.assign('http://[bad'), { name: 'SyntaxError' });
  });

  it("is set as the document's location as well", async () => {
    const source: DeepLinkSource = {
      launchUrl: () => Promise.resolve(null),
      subscribe: () => () => {},
      open: () => {},
    };
    const { app, document } = await page([
      provideWebCompat({ url: 'https://shop.example/' }),
      { provide: DeepLinks.SOURCE, useValue: source },
    ]);
    const followed: string[] = [];
    const stop = app.componentRef.injector.get(DeepLinks).subscribe((path) => followed.push(path));
    try {
      document.location = '/account';
    } finally {
      stop();
    }
    assert.deepEqual(followed, ['/account']);
  });

  it("follows a path off Expo Go's /-- into the app, and keeps a build's scheme", async () => {
    const opened: string[] = [];
    const source: DeepLinkSource = {
      launchUrl: () => Promise.resolve(null),
      subscribe: () => () => {},
      open: (url) => void opened.push(url),
    };
    const followed: string[] = [];
    const go = async (url: string, targets: string[]) => {
      const { app } = await page([
        provideWebCompat({ url }),
        { provide: DeepLinks.SOURCE, useValue: source },
      ]);
      const links = app.componentRef.injector.get(DeepLinks);
      const stop = links.subscribe((path) => followed.push(path));
      for (const target of targets) (globalThis as Dom).location.assign(target);
      stop();
      await cleanup();
    };
    // `/team` is `exp://127.0.0.1:8081/team` against the page, which is outside `/--`.
    await go('exp://127.0.0.1:8081/--/', [
      '/team',
      'exp://127.0.0.1:8081/--/orders',
      'exps://127.0.0.1:8081/cart',
      'exp://127.0.0.1:8082/team',
    ]);
    await go('canary://', ['/team', 'other://team']);
    assert.deepEqual(followed, ['/team', '/orders', '/team']);
    assert.deepEqual(opened, [
      'exps://127.0.0.1:8081/cart',
      'exp://127.0.0.1:8082/team',
      'other://team',
    ]);
  });

  it('speaks for the newest app still up, and for none of one that is gone', async () => {
    const one = await page([provideWebCompat({ url: 'https://one.example/' })]);
    const two = await page([provideWebCompat({ url: 'https://two.example/' })]);
    assert.equal((globalThis as Dom).location.href, 'https://two.example/');
    two.app.unmount();
    assert.equal((globalThis as Dom).location.href, 'https://one.example/');
    assert.equal(two.document.location, null);
    assert.equal(one.document.location, (globalThis as Dom).location);
  });

  it('is there while an app is up, and is not put over one the runtime has', async () => {
    const scope = globalThis as Dom;
    assert.equal(scope.location, undefined);
    await page();
    assert.equal(scope.location.href, 'https://shop.example/');
    await cleanup();
    assert.equal(scope.location, undefined, 'gone with the app');
    const own = { href: 'http://runtime.example/' };
    scope.location = own;
    try {
      await page();
      assert.equal(scope.location, own);
    } finally {
      delete scope.location;
    }
  });
});

describe('baseURI', () => {
  it("is the page's for an attribute, on an element or on none", async () => {
    const { document } = await page();
    const loose = document.createAttribute('class');
    assert.equal(loose.baseURI, 'https://shop.example/');
    const link = document.getElementById('link');
    link.setAttribute('class', 'x');
    assert.equal(link.getAttributeNode('class').baseURI, 'https://shop.example/');
  });
});

describe(':target', () => {
  it("is the element in the page the address's fragment names, as the route moves", async () => {
    const history = new StillLocation();
    const { document } = await page([
      provideWebCompat({ url: 'https://shop.example/' }),
      { provide: PlatformLocation, useValue: history },
    ]);
    const link = document.getElementById('link');
    const section = document.createElement('section');
    section.id = 'paid now';
    document.body.appendChild(section);
    assert.equal(document.querySelector(':target'), null, 'no fragment');
    Object.assign(history, { hash: '#link' });
    assert.equal(document.querySelector(':target'), link);
    assert.equal(link.matches(':target'), true);
    Object.assign(history, { hash: '#paid%20now' });
    assert.equal(document.querySelector(':target'), section, 'its id decoded');
    assert.equal(link.matches(':target'), false);
    section.remove();
    assert.equal(section.matches(':target'), false, 'out of the page');
    Object.assign(history, { hash: '#' });
    assert.equal(document.querySelector(':target'), null, 'an empty fragment');
  });

  it('is the first element with the id, else the first <a> of the name, as written first', async () => {
    const history = new StillLocation();
    const { document } = await page([
      provideWebCompat({ url: 'https://shop.example/' }),
      { provide: PlatformLocation, useValue: history },
    ]);
    const [first, second, anchor, literal] = ['p', 'p', 'a', 'p'].map((tag) => {
      const element = document.createElement(tag);
      document.body.appendChild(element);
      return element;
    });
    first.id = 'twice';
    second.id = 'twice';
    anchor.setAttribute('name', 'named');
    literal.id = 'a%20b';
    Object.assign(history, { hash: '#twice' });
    assert.deepEqual(Array.from(document.querySelectorAll(':target')), [first]);
    Object.assign(history, { hash: '#named' });
    assert.equal(document.querySelector(':target'), anchor);
    Object.assign(history, { hash: '#a%20b' });
    assert.equal(document.querySelector(':target'), literal, 'the id as it is written');
  });
});
