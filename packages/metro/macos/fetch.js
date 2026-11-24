/**
 * The `fetch` a `macos` bundle gets from `import 'expo'`: its `Response` streams a `body`, as
 * Expo's `fetch` does on iOS and Android, over React Native's Networking module rather than
 * Expo's native fetch module, which a desktop host does not have.
 *
 * Each request asks Networking for a `base64-chunks` response with incremental updates, which the
 * desktop host streams: every `didReceiveNetworkIncrementalData` event is one chunk of the body, as
 * it arrived, in base64 of its own, decoded here to its bytes, so `body`, `bytes()` and `arrayBuffer()` are byte-exact for any
 * content. A host that sends the body whole in `didReceiveNetworkData` instead, as React Native
 * iOS does, still gives the same bytes, all at the end. `blob()` is made from the body as text,
 * since React Native's `Blob` takes no bytes, and refuses a body that is not UTF-8 text.
 *
 * CommonJS, so Node tests can load it as it ships.
 */
'use strict';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUE = new Uint8Array(128).fill(255);
for (let i = 0; i < BASE64.length; i++) BASE64_VALUE[BASE64.charCodeAt(i)] = i;

/** The bytes `text`, base64 with or without padding, encodes. Other characters are skipped. */
function base64Bytes(text) {
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let length = 0;
  let bits = 0;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const value = code < 128 ? BASE64_VALUE[code] : 255;
    if (value === 255) continue;
    bits = (bits << 6) | value;
    count += 6;
    if (count >= 8) {
      count -= 8;
      out[length++] = (bits >> count) & 0xff;
    }
  }
  return out.subarray(0, length);
}

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

/**
 * Whether `input` is a `Request` whose body was read already, which `fetch` refuses as the Fetch
 * standard's `Request` constructor does, unless `init` gives a body in its place.
 */
function consumedRequest(init, input) {
  return isRequest(input) && input.bodyUsed === true && !(init && init.body != null);
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

/**
 * Chunks from Networking, waiting for a reader; `end` closes it and `fail` errors it. `fail` still
 * errors it after `end`, until the reader has taken the end, so an abort drops what was not read.
 * `onClose` runs once the reader has taken the end or the error, or `fail` errors it.
 */
class Chunks {
  constructor(onClose) {
    this.queue = [];
    this.waiting = [];
    this.done = false;
    this.closed = false;
    this.error = undefined;
    this.onClose = onClose;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.onClose?.();
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
    const waiting = this.waiting.splice(0);
    if (waiting.length > 0) this.close();
    for (const waiter of waiting) waiter.resolve({ done: true, value: undefined });
  }

  fail(error) {
    if (this.closed || this.error !== undefined) return;
    this.done = true;
    this.error = error;
    this.queue.length = 0;
    this.close();
    for (const waiter of this.waiting.splice(0)) waiter.reject(error);
  }

  next() {
    if (this.queue.length > 0) return Promise.resolve({ done: false, value: this.queue.shift() });
    if (this.error !== undefined) return Promise.reject(this.error);
    if (this.done) {
      this.close();
      return Promise.resolve({ done: true, value: undefined });
    }
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

  /**
   * From the text, which React Native's `Blob` takes where it does not take bytes. A body that is
   * not UTF-8 text is refused rather than changed: decoding it would replace what is not text.
   */
  async blob() {
    this._take('blob');
    const bytes = await this._read();
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new TypeError(
        "Failed to execute 'blob' on 'Response': on macOS a Blob is made from text, and this body " +
          'is not UTF-8 text. Read it with arrayBuffer() or bytes() instead.',
      );
    }
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
      if (consumedRequest(init, input)) {
        reject(new TypeError("Failed to execute 'fetch': the Request's body is already used."));
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

      // The signal is listened to until the body is read to its end or errored, past the request's
      // completion: an abort then errors what is left unread, as the Fetch standard has it.
      const chunks = new Chunks(() => signal?.removeEventListener('abort', onAbort));
      let id = null;
      let early = [];
      let settled = false;
      let finished = false;
      let abortWhenKnown = false;
      let hasBody = true;

      const subscriptions = [];
      function stop() {
        for (const subscription of subscriptions.splice(0)) subscription.remove();
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
        const finalUrl = responseUrl || url;
        hasBody = !(method.toUpperCase() === 'HEAD' || status === 204 || status === 304);
        resolve(
          new StreamingResponse(
            {
              status,
              headers: headerList,
              url: finalUrl,
              redirected: finalUrl !== url,
            },
            !hasBody
              ? null
              : (markUsed) =>
                  pulledStream(
                    () => chunks.next(),
                    () => {
                      chunks.end();
                      chunks.close();
                      abortNative();
                      stop();
                    },
                    markUsed,
                  ),
          ),
        );
      }
      function onData(base64) {
        if (typeof base64 !== 'string') return;
        const bytes = base64Bytes(base64);
        if (bytes.byteLength > 0) chunks.push(bytes);
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
        if (!hasBody) chunks.close();
      }
      function dispatch(event, args) {
        if (event === 'response') onResponse(args[1], args[2], args[3]);
        else if (event === 'data') onData(args[1]);
        else onComplete(args[1], args[2]);
      }
      function listen(name, event) {
        subscriptions.push(
          // Each event's arguments arrive as one array, as React Native's XMLHttpRequest reads them.
          networking.addListener(name, (args) => {
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

      try {
        networking.sendRequest(
          method,
          undefined,
          url,
          headerObject(headers),
          body,
          'base64-chunks',
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
      } catch (error) {
        // Networking refused the request outright: nothing will arrive, so stop listening.
        finished = true;
        stop();
        signal?.removeEventListener('abort', onAbort);
        settled = true;
        reject(error);
      }
    });
  };
}

module.exports = { createFetch, StreamingResponse };
