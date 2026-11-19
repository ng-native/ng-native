import { ɵDomAdapter as DomAdapter, ɵgetDOM as getDOM, ɵsetRootDomAdapter } from '@angular/common';
import { parseUrl } from './parse-url.ts';

/** What the adapter is handed: a node, a document or an event, loosely typed as a library's are. */
type Dom = any;

/**
 * Angular's DOM adapter, `getDOM()`, over the nodes and the document this package gives an app.
 * `@angular/platform-browser` and `@angular/common` reach for it where they make or take away an
 * element: `Meta` makes its `<meta>` with it and takes one away with it, and a library calls
 * `Meta` as it starts, as Taiga UI's `provideTaiga()` does for its font scaling. A device boots no
 * browser platform, so there is none until this package gives one.
 *
 * It keeps nothing: each answer is read from what it is handed, or from the global `document`
 * and `window` as they are when it is asked, so it speaks for the newest app up, as the global
 * `document` does, and holds nothing of an app that has gone.
 *
 * What it answers as Angular's browser adapter does, by the members this package gives: events
 * sent and listened for, an element made, taken away and told from other nodes, a document made,
 * the window, the document and the body as targets, the base path of a `<base href>` in the head,
 * and the user agent. What there is none of on a device it answers as Angular's server adapter
 * does where it has none: no shadow root, and no cookie.
 */
export class WebCompatDomAdapter extends DomAdapter {
  readonly supportsDOMEvents = true;

  dispatchEvent(el: Dom, evt: Dom): void {
    el.dispatchEvent(evt);
  }

  remove(el: Dom): void {
    el.remove();
  }

  createElement(tagName: string, doc?: Dom): HTMLElement {
    return (doc ?? this.getDefaultDocument()).createElement(tagName);
  }

  /** A document of its own, which is never drawn: see `dom-implementation.ts`. */
  createHtmlDocument(): Document {
    return this.getDefaultDocument().implementation.createHTMLDocument('fakeTitle');
  }

  /** The newest app's document, which the global `document` is. */
  getDefaultDocument(): Document {
    return (globalThis as Dom).document;
  }

  isElementNode(node: Dom): boolean {
    return node?.nodeType === 1;
  }

  /** There are no shadow roots here: `ShadowRoot` is a stand-in nothing is an instance of. */
  isShadowRoot(_node: unknown): boolean {
    return false;
  }

  onAndCancel(el: Dom, evt: string, listener: unknown, options?: unknown): () => void {
    el.addEventListener(evt, listener, options);
    return () => el.removeEventListener(evt, listener, options);
  }

  getGlobalEventTarget(doc: Dom, target: string): unknown {
    if (target === 'window') return doc?.defaultView ?? globalThis;
    if (target === 'document') return doc;
    if (target === 'body') return doc?.body;
    return null;
  }

  /**
   * The path of the first `<base href>` in the head, resolved against the page's address: read
   * each time it is asked, so there is nothing to reset.
   */
  getBaseHref(doc: Dom): string | null {
    const href = doc?.head?.querySelector('base[href]')?.getAttribute('href');
    if (href == null) return null;
    return parseUrl(href, doc.URL)?.pathname ?? null;
  }

  /** Nothing is kept between `getBaseHref`'s answers. */
  resetBaseElement(): void {}

  /** A phone's browser's, where the runtime has none: see `navigator-identity.ts`. */
  getUserAgent(): string {
    return (globalThis as Dom).navigator?.userAgent ?? '';
  }

  /** There are no cookies: the document has no `cookie`. */
  getCookie(_name: string): string | null {
    return null;
  }
}

/**
 * Make Angular's DOM adapter this package's, where there is none. One an app set itself, or a
 * browser platform's, is left alone. Angular takes an adapter once and never gives it back, so
 * this one stays once given; it holds nothing, so an app that has gone leaves nothing in it.
 */
export function installDomAdapter(): void {
  if (!getDOM()) ɵsetRootDomAdapter(new WebCompatDomAdapter());
}
