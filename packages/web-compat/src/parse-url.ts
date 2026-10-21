/**
 * A URL, read as `URL` reads one where the runtime's `URL` is the URL Standard's, and as RFC 3986
 * reads one where it is not. React Native's is not: it refuses a base that is not `http`, resolves
 * a relative URL by joining the two strings, and reads the parts of an `http` URL only, so a link
 * in an app whose address is `canary:///` or `exp://` would resolve to nothing or to nonsense.
 *
 * ponytail: the fallback is RFC 3986 with the URL Standard's trimming, lower-cased scheme and
 * host, default ports and opaque paths. No percent-encoding, IDNA, backslashes or IPv6 hosts.
 */

/** What is read and set of a URL: `URL` itself has all of it. */
export interface UrlRecord {
  readonly href: string;
  readonly origin: string;
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
}

/** The runtime's `URL`, where it is the URL Standard's: asked once for each `URL` there is. */
let asked: unknown;
let standard = false;

function standardUrl(): typeof URL | null {
  const Url = (globalThis as { URL?: typeof URL }).URL;
  if (Url !== asked) {
    asked = Url;
    try {
      standard = !!Url && new Url('../c?d#e', 'x-probe://h/a/b/').href === 'x-probe://h/a/c?d#e';
    } catch {
      standard = false;
    }
  }
  return standard ? Url! : null;
}

/** `input`, resolved against `base` where there is one, or null where it is no URL. */
export function parseUrl(input: string, base?: string): UrlRecord | null {
  const Url = standardUrl();
  if (Url) {
    try {
      return base === undefined ? new Url(input) : new Url(input, base);
    } catch {
      return null;
    }
  }
  return plainUrl(input, base);
}

/** The schemes the URL Standard gives a host and an origin, by their default port. */
const SPECIAL: Readonly<Record<string, string>> = {
  http: '80',
  https: '443',
  ws: '80',
  wss: '443',
  ftp: '21',
  file: '',
};

const PARTS = /^(?:([a-z][a-z\d+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i;

interface Reference {
  scheme: string | undefined;
  authority: string | undefined;
  path: string;
  query: string | undefined;
  fragment: string | undefined;
}

function referenceOf(text: string): Reference {
  // Always matches: every part is optional.
  const [, scheme, authority, path = '', query, fragment] = PARTS.exec(text)!;
  return { scheme: scheme?.toLowerCase(), authority, path, query, fragment };
}

/** RFC 3986's remove_dot_segments, for a path that starts with `/`. */
function withoutDots(path: string): string {
  if (!path.includes('.')) return path;
  const segments = path.split('/');
  const out: string[] = [];
  segments.forEach((segment, at) => {
    const last = at === segments.length - 1;
    if (segment === '.' || segment === '..') {
      if (segment === '..' && out.length > 1) out.pop();
      if (last) out.push('');
    } else out.push(segment);
  });
  return out.join('/');
}

function plainUrl(input: string, base?: string): PlainUrl | null {
  const text = input.replace(/^[\u0000- ]+|[\u0000- ]+$/g, '').replace(/[\t\n\r]/g, '');
  const reference = referenceOf(text);
  if (reference.scheme) return PlainUrl.from(reference);
  const from = base === undefined ? null : plainUrl(base);
  return from && PlainUrl.from(resolved(reference, from));
}

/** RFC 3986's resolution of a reference with no scheme against a base, or null where it has none. */
function resolved(reference: Reference, from: PlainUrl): Reference {
  const target: Reference = { ...reference, scheme: from.scheme };
  if (reference.authority !== undefined) return target;
  // A base with an opaque path, as `about:blank` has, takes nothing but a fragment.
  if (from.authority === undefined && !from.path.startsWith('/')) {
    const fragmentOnly = !reference.path && reference.query === undefined;
    return fragmentOnly && reference.fragment !== undefined
      ? { ...from.reference, fragment: reference.fragment }
      : { ...target, scheme: undefined };
  }
  target.authority = from.authority;
  if (reference.path === '') {
    target.path = from.path;
    target.query = reference.query ?? from.query;
  } else if (!reference.path.startsWith('/')) {
    const folder =
      from.authority !== undefined && from.path === ''
        ? '/'
        : from.path.slice(0, from.path.lastIndexOf('/') + 1);
    target.path = folder + reference.path;
  }
  return target;
}

/** A URL as RFC 3986 parts, read and set as `URL`'s are. */
class PlainUrl implements UrlRecord {
  scheme = '';
  /** `undefined` where the URL has no `//`. */
  authority: string | undefined;
  path = '';
  query: string | undefined;
  fragment: string | undefined;

  static from(reference: Reference): PlainUrl | null {
    if (!reference.scheme) return null;
    const url = new PlainUrl();
    url.scheme = reference.scheme!;
    url.authority = reference.authority;
    if (url.authority !== undefined && url.special) {
      const [info, hostname, port] = url.split();
      url.join(info, hostname.toLowerCase(), port === SPECIAL[url.scheme] ? '' : port);
    }
    if (url.authority !== undefined && !/^(?:[^@]*@)?[^:@[\]]*(?::\d*)?$/.test(url.authority)) {
      return null;
    }
    url.path = reference.path.startsWith('/') ? withoutDots(reference.path) : reference.path;
    if (url.special && url.path === '') url.path = '/';
    url.query = reference.query;
    url.fragment = reference.fragment;
    return url;
  }

  get reference(): Reference {
    const { scheme, authority, path, query, fragment } = this;
    return { scheme, authority, path, query, fragment };
  }

  private get special(): boolean {
    return this.scheme in SPECIAL;
  }

  /** The authority as user info, host name and port. */
  private split(): [userInfo: string, hostname: string, port: string] {
    const authority = this.authority ?? '';
    const at = authority.lastIndexOf('@');
    const info = at === -1 ? '' : authority.slice(0, at + 1);
    const [hostname = '', port = ''] = authority.slice(at + 1).split(':');
    return [info, hostname, port];
  }

  private join(info: string, hostname: string, port: string): void {
    if (this.authority === undefined && !hostname) return;
    this.authority = info + hostname + (port ? `:${port}` : '');
  }

  get href(): string {
    const authority = this.authority === undefined ? '' : `//${this.authority}`;
    const query = this.query === undefined ? '' : `?${this.query}`;
    const fragment = this.fragment === undefined ? '' : `#${this.fragment}`;
    return `${this.scheme}:${authority}${this.path}${query}${fragment}`;
  }

  get origin(): string {
    return this.special && this.scheme !== 'file' ? `${this.scheme}://${this.host}` : 'null';
  }

  get protocol(): string {
    return `${this.scheme}:`;
  }
  set protocol(value: string) {
    const scheme = /^([a-z][a-z\d+.-]*):?/i.exec(value)?.[1]?.toLowerCase();
    if (scheme) this.scheme = scheme;
  }

  get username(): string {
    return this.split()[0].replace(/(?::[^@]*)?@$/, '');
  }
  set username(value: string) {
    const [, hostname, port] = this.split();
    const password = this.password;
    const info = value || password ? `${value}${password ? `:${password}` : ''}@` : '';
    this.join(info, hostname, port);
  }

  get password(): string {
    return /:([^@]*)@$/.exec(this.split()[0])?.[1] ?? '';
  }
  set password(value: string) {
    const [, hostname, port] = this.split();
    const user = this.username;
    this.join(user || value ? `${user}${value ? `:${value}` : ''}@` : '', hostname, port);
  }

  get host(): string {
    const [, hostname, port] = this.split();
    return port ? `${hostname}:${port}` : hostname;
  }
  set host(value: string) {
    const [hostname = '', port] = value.split(':');
    const [info, , was] = this.split();
    this.join(info, hostname, port ?? was);
  }

  get hostname(): string {
    return this.split()[1];
  }
  set hostname(value: string) {
    const [info, , port] = this.split();
    this.join(info, value, port);
  }

  get port(): string {
    return this.split()[2];
  }
  set port(value: string) {
    if (!/^\d*$/.test(value)) return;
    const [info, hostname] = this.split();
    this.join(info, hostname, value);
  }

  get pathname(): string {
    return this.path;
  }
  set pathname(value: string) {
    this.path = this.authority === undefined || value.startsWith('/') ? value : `/${value}`;
  }

  get search(): string {
    return this.query ? `?${this.query}` : '';
  }
  set search(value: string) {
    const query = value.replace(/^\?/, '');
    this.query = query ? query : undefined;
  }

  get hash(): string {
    return this.fragment ? `#${this.fragment}` : '';
  }
  set hash(value: string) {
    const fragment = value.replace(/^#/, '');
    this.fragment = fragment ? fragment : undefined;
  }

  toString(): string {
    return this.href;
  }
}
