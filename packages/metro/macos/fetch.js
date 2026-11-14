/**
 * The `fetch` a `macos` bundle gets from `import 'expo'`: its `Response` streams a `body`, as
 * Expo's `fetch` does on iOS and Android, over React Native's Networking module rather than
 * Expo's native fetch module, which a desktop host does not have.
 *
 * Each request asks Networking for a text response with incremental updates, so every
 * `didReceiveNetworkIncrementalData` event is one chunk of the body, as UTF-8 bytes. The body is
 * therefore text: a binary response read through `body`, `arrayBuffer()` or `blob()` is not
 * byte-exact, and a dev build warns once when one arrives. `XMLHttpRequest`, and so
 * `provideNativeHttpClient()`, is untouched and reads binary bodies whole.
 *
 * CommonJS, so Node tests can load it as it ships.
 */
'use strict';

const TEXT_TYPE =
  /^\s*(text\/|application\/(json|xml|javascript|ecmascript|x-www-form-urlencoded|x-ndjson|ndjson|graphql)\b|[^;]*\+(json|xml)\b)|;\s*charset=/i;

let warnedBinary = false;

/** The error a rejected or aborted request gives when its signal has no reason of its own. */
function abortError(signal) {
  if (signal && signal.reason !== undefined) return signal.reason;
  if (typeof DOMException === 'function') {
    return new DOMException('The operation was aborted.', 'AbortError');
  }
  return Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}

function isRequest(input) {
  return input != null && typeof input === 'object' && typeof input.url === 'string';
}

/** A request's body: `whatwg-fetch`'s `Request` keeps what it was given in `_bodyInit`. */
function requestBody(init, input) {
  if (init && init.body != null) return init.body;
  if (isRequest(input)) {
    if ('_bodyInit' in input) return input._noBody === true ? null : (input._bodyInit ?? null);
    return input.body ?? null;
  }
  return null;
}

/** A plain-object copy of `headers`, which is what Networking takes. */
function headerObject(headers) {
  const out = {};
  headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
}

/**
 * A body with no `ReadableStream` of its own, so every read goes through `pull` and marks the
 * response used, and chunks wait here until something reads them.
 */
function pulledStream(next, cancel, markUsed) {
  return new ReadableStream(
    {
      async pull(controller) {
        markUsed();
        const { done, value } = await next();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel(reason) {
        markUsed();
        return cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

/** Chunks from Networking, waiting for a reader; `end` closes it and `fail` errors it. */
class Chunks {
  constructor() {
    this.queue = [];
    this.waiting = [];
    this.done = false;
    this.error = undefined;
  }

  push(chunk) {
    if (this.done) return;
    const waiter = this.waiting.shift();
    if (waiter) waiter.resolve({ done: false, value: chunk });
    else this.queue.push(chunk);
  }

  end() {
    if (this.done) return;
    this.done = true;
    for (const waiter of this.waiting.splice(0)) waiter.resolve({ done: true, value: undefined });
  }

  fail(error) {
    if (this.done) return;
    this.done = true;
    this.error = error;
    this.queue.length = 0;
    for (const waiter of this.waiting.splice(0)) waiter.reject(error);
  }

  next() {
    if (this.queue.length > 0) return Promise.resolve({ done: false, value: this.queue.shift() });
    if (this.error !== undefined) return Promise.reject(this.error);
    if (this.done) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }
}

class StreamingResponse {
  constructor(meta, body) {
    this.status = meta.status;
    this.statusText = meta.statusText ?? '';
    this.ok = meta.status >= 200 && meta.status < 300;
    this.headers = meta.headers;
    this.url = meta.url;
    this.redirected = meta.redirected;
    this.type = 'basic';
    this._used = false;
    this._body = null;
    if (body) this._wrap(body);
  }

  /**
   * Makes the body from `make`, whose stream marks this response used when read. A clone tees
   * the body and wraps this side again, so the old stream, which the tee reads, no longer does.
   */
  _wrap(make) {
    const current = {};
    this._current = current;
    this._body = make(() => {
      if (this._current === current) this._used = true;
    });
  }

  get body() {
    return this._body;
  }

  get bodyUsed() {
    return this._used;
  }

  _take(method) {
    if (this._used || (this._body !== null && this._body.locked)) {
      throw new TypeError(`Failed to execute '${method}' on 'Response': body is already used.`);
    }
    this._used = true;
  }

  async _read() {
    if (this._body === null) return new Uint8Array(0);
    const reader = this._body.getReader();
    const parts = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      length += value.byteLength;
    }
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out;
  }

  async bytes() {
    this._take('bytes');
    return this._read();
  }

  async arrayBuffer() {
    this._take('arrayBuffer');
    return (await this._read()).buffer;
  }

  async text() {
    this._take('text');
    return new TextDecoder().decode(await this._read());
  }

  async json() {
    this._take('json');
    return JSON.parse(new TextDecoder().decode(await this._read()));
  }

  /** From the text, which React Native's `Blob` takes where it does not take bytes. */
  async blob() {
    this._take('blob');
    const text = new TextDecoder().decode(await this._read());
    return new Blob([text], { type: this.headers.get('content-type') ?? '' });
  }

  clone() {
    if (this._used || (this._body !== null && this._body.locked)) {
      throw new TypeError("Failed to execute 'clone' on 'Response': body is already used.");
    }
    const meta = {
      status: this.status,
      statusText: this.statusText,
      headers: new Headers(this.headers),
      url: this.url,
      redirected: this.redirected,
    };
    if (this._body === null) return new StreamingResponse(meta, null);
    const [own, other] = this._body.tee();
    const branch = (stream) => (markUsed) => {
      const reader = stream.getReader();
      return pulledStream(
        () => reader.read(),
        (reason) => reader.cancel(reason),
        markUsed,
      );
    };
    this._wrap(branch(own));
    return new StreamingResponse(meta, branch(other));
  }
}

Object.defineProperty(StreamingResponse.prototype, Symbol.toStringTag, {
  value: 'Response',
  configurable: true,
});

/**
 * A `fetch` over `networking`, React Native's `RCTNetworking` (`addListener`, `sendRequest`,
 * `abortRequest`).
 */
function createFetch(networking) {
  return function fetch(input, init) {
    return new Promise((resolve, reject) => {
      const url = isRequest(input) ? input.url : String(input);
      const signal = (init && init.signal) ?? (isRequest(input) ? input.signal : undefined);
      if (signal && signal.aborted) {
        reject(abortError(signal));
        return;
      }
      const method = String((init && init.method) ?? (isRequest(input) ? input.method : 'GET'));
      const headers = new Headers(
        (init && init.headers) ?? (isRequest(input) ? input.headers : undefined),
      );
      let body = requestBody(init, input);
      if (typeof URLSearchParams === 'function' && body instanceof URLSearchParams) {
        body = body.toString();
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
        }
      } else if (typeof body === 'string' && !headers.has('content-type')) {
        headers.set('content-type', 'text/plain;charset=UTF-8');
      } else if (
        typeof Blob === 'function' &&
        body instanceof Blob &&
        body.type &&
        !headers.has('content-type')
      ) {
        headers.set('content-type', body.type);
      }
      const credentials =
        (init && init.credentials) ?? (isRequest(input) ? input.credentials : undefined);

      const encoder = new TextEncoder();
      const chunks = new Chunks();
      let id = null;
      let early = [];
      let settled = false;
      let finished = false;
      let abortWhenKnown = false;

      const subscriptions = [];
      function stop() {
        for (const subscription of subscriptions.splice(0)) subscription.remove();
        signal?.removeEventListener('abort', onAbort);
      }
      function abortNative() {
        if (finished) return;
        finished = true;
        if (id === null) abortWhenKnown = true;
        else networking.abortRequest(id);
      }

      function onResponse(status, responseHeaders, responseUrl) {
        if (settled) return;
        settled = true;
        const headerList = new Headers(responseHeaders ?? {});
        const type = headerList.get('content-type');
        if (type && !TEXT_TYPE.test(type) && !warnedBinary && globalThis.__DEV__) {
          warnedBinary = true;
          console.warn(
            `fetch on macOS reads a body as text, so this ${type} response from ${url} is not ` +
              'byte-exact through body, arrayBuffer() or blob(). Read binary responses through ' +
              'XMLHttpRequest, or HttpClient with provideNativeHttpClient().',
          );
        }
        const finalUrl = responseUrl || url;
        resolve(
          new StreamingResponse(
            {
              status,
              headers: headerList,
              url: finalUrl,
              redirected: finalUrl !== url,
            },
            method.toUpperCase() === 'HEAD' || status === 204 || status === 304
              ? null
              : (markUsed) =>
                  pulledStream(
                    () => chunks.next(),
                    () => {
                      chunks.end();
                      abortNative();
                      stop();
                    },
                    markUsed,
                  ),
          ),
        );
      }
      function onData(text) {
        if (typeof text === 'string' && text.length > 0) chunks.push(encoder.encode(text));
      }
      function onComplete(error, timedOut) {
        finished = true;
        stop();
        if (error) {
          const failure = new TypeError(timedOut ? `Request timed out: ${error}` : error);
          if (!settled) {
            settled = true;
            reject(failure);
          }
          chunks.fail(failure);
          return;
        }
        if (!settled) onResponse(200, {}, url);
        chunks.end();
      }
      function dispatch(event, args) {
        if (event === 'response') onResponse(args[1], args[2], args[3]);
        else if (event === 'data') onData(args[1]);
        else onComplete(args[1], args[2]);
      }
      function listen(name, event) {
        subscriptions.push(
          networking.addListener(name, (...args) => {
            if (id === null) early.push([event, args]);
            else if (args[0] === id) dispatch(event, args);
          }),
        );
      }
      function onAbort() {
        const reason = abortError(signal);
        abortNative();
        stop();
        if (!settled) {
          settled = true;
          reject(reason);
        }
        chunks.fail(reason);
      }

      listen('didReceiveNetworkResponse', 'response');
      listen('didReceiveNetworkIncrementalData', 'data');
      listen('didReceiveNetworkData', 'data');
      listen('didCompleteNetworkResponse', 'complete');
      signal?.addEventListener('abort', onAbort);

      networking.sendRequest(
        method,
        undefined,
        url,
        headerObject(headers),
        body,
        'text',
        true,
        0,
        (requestId) => {
          id = requestId;
          if (abortWhenKnown) {
            networking.abortRequest(id);
            early = [];
            return;
          }
          for (const [event, args] of early.splice(0)) {
            if (args[0] === id) dispatch(event, args);
          }
        },
        credentials !== 'omit',
      );
    });
  };
}

module.exports = { createFetch, StreamingResponse };
