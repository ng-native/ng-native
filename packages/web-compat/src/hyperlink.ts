import { parseUrl, type UrlRecord } from './parse-url.ts';
import { baseOf, contentOf, method, own, type Reflecting, type Reflection } from './reflect.ts';

/**
 * HTML's `HTMLHyperlinkElementUtils`, which an `<a>` and an `<area>` have: `href` and the parts of
 * the URL it says, `host`, `pathname` and the rest, each read and set as a `URL`'s is. Setting a
 * part writes the whole URL back to `href`.
 *
 * A relative `href` is resolved against the page's address: see `page-address.ts`. One that does
 * not parse is no URL: `href` reads as written and the parts as the spec has them for no URL,
 * which is `:` for `protocol` and empty for the rest.
 */

type Part =
  | 'protocol'
  | 'username'
  | 'password'
  | 'host'
  | 'hostname'
  | 'port'
  | 'pathname'
  | 'search'
  | 'hash';

/** The URL `href` says, or none: see `parse-url.ts` for where the runtime's `URL` is not used. */
function urlOf(node: Reflecting): UrlRecord | null {
  const written = contentOf(node, 'href', 'href');
  return written === null ? null : parseUrl(written, baseOf(node));
}

/** One part of the URL: read off it, or `none` where there is no URL, and set on it. */
const part = (name: Part, none = ''): Reflection =>
  own(
    (node) => urlOf(node)?.[name] ?? none,
    (node, value) => {
      const url = urlOf(node);
      if (!url) return;
      try {
        url[name] = String(value);
      } catch {
        return;
      }
      node.setAttribute('href', url.href);
    },
  );

const HYPERLINK: Readonly<Record<string, Reflection>> = {
  href: own(
    (node) => urlOf(node)?.href ?? contentOf(node, 'href', 'href') ?? '',
    (node, value) => node.setAttribute('href', String(value)),
  ),
  origin: own((node) => urlOf(node)?.origin ?? ''),
  protocol: part('protocol', ':'),
  username: part('username'),
  password: part('password'),
  host: part('host'),
  hostname: part('hostname'),
  port: part('port'),
  pathname: part('pathname'),
  search: part('search'),
  hash: part('hash'),
  // A link is its URL as a string, as a template interpolates it.
  toString: method(function (this: Reflecting) {
    return urlOf(this)?.href ?? contentOf(this, 'href', 'href') ?? '';
  }),
};

export const HYPERLINKS: Readonly<Record<string, Readonly<Record<string, Reflection>>>> = {
  a: HYPERLINK,
  area: HYPERLINK,
};
