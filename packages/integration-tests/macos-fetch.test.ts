/**
 * The `fetch` a `macos` bundle's `import 'expo'` installs, over a stand-in for React Native's
 * Networking module that sends its events when a test says so: in chunks, before the request id
 * has reached JavaScript, for other requests, and with errors.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { provideHttpClient, type HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const require = createRequire(import.meta.url);
const { createFetch } = require('@ng-native/metro/macos/fetch.js') as {
  createFetch(networking: FakeNetworking): typeof fetch;
};

type Listener = (args: unknown[]) => void;

interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  data: unknown;
  responseType: string;
  incrementalUpdates: boolean;
  withCredentials: boolean;
  /** Hands JavaScript the request id, which `idLate` holds back until a test calls it. */
  giveId(): void;
}

/** React Native's `RCTNetworking`, as far as `fetch` uses it. */
class FakeNetworking {
  listeners = new Map<string, Set<Listener>>();
  sent: Sent[] = [];
  aborted: number[] = [];
  nextId = 1;
  idLate = false;

  addListener(name: string, listener: Listener): { remove(): void } {
    const set = this.listeners.get(name) ?? new Set();
    this.listeners.set(name, set);
    set.add(listener);
    return { remove: () => set.delete(listener) };
  }

  sendRequest(
    method: string,
    _trackingName: unknown,
    url: string,
    headers: Record<string, string>,
    data: unknown,
    responseType: string,
    incrementalUpdates: boolean,
    _timeout: number,
    callback: (id: number) => void,
    withCredentials: boolean,
  ): void {
    const id = this.nextId++;
    const giveId = (): void => callback(id);
    this.sent.push({
      method,
      url,
      headers,
      data,
      responseType,
      incrementalUpdates,
      withCredentials,
      giveId,
    });
    if (!this.idLate) giveId();
  }

  abortRequest(id: number): void {
    this.aborted.push(id);
  }

  /** Each event's arguments arrive as one array, as `RCTDeviceEventEmitter` delivers them. */
  emit(name: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(name) ?? [])]) listener(args);
  }

  respond(id: number, status = 200, headers: Record<string, string> = {}, url = ''): void {
    this.emit('didReceiveNetworkResponse', id, status, headers, url);
  }

  /** One chunk of the body, base64 as the host streams it: text as its UTF-8 bytes. */
  chunk(id: number, data: string | Uint8Array): void {
    this.emit('didReceiveNetworkIncrementalData', id, Buffer.from(data).toString('base64'), 0, -1);
  }

  complete(id: number, error: string | null = null, timedOut = false): void {
    this.emit('didCompleteNetworkResponse', id, error, timedOut);
  }

  get listening(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

function setUp(): { net: FakeNetworking; fetch: typeof fetch } {
  const net = new FakeNetworking();
  return { net, fetch: createFetch(net) };
}

/** Lets promise callbacks run. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('fetch on macOS', () => {
  it('asks Networking for a base64 body with incremental updates', async () => {
    const { net, fetch } = setUp();
    void fetch('https://api.test/a', {
      method: 'POST',
      headers: { 'X-Token': 't' },
      body: '{"a":1}',
      credentials: 'omit',
    });
    const sent = net.sent[0]!;
    assert.equal(sent.method, 'POST');
    assert.equal(sent.url, 'https://api.test/a');
    assert.equal(sent.data, '{"a":1}');
    assert.equal(sent.headers['x-token'], 't');
    assert.equal(sent.headers['content-type'], 'text/plain;charset=UTF-8');
    assert.equal(sent.responseType, 'base64');
    assert.equal(sent.incrementalUpdates, true);
    assert.equal(sent.withCredentials, false);
  });

  it('keeps a content type the caller set, and sends cookies by default', () => {
    const { net, fetch } = setUp();
    void fetch('https://api.test/a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(net.sent[0]!.headers['content-type'], 'application/json');
    assert.equal(net.sent[0]!.withCredentials, true);
  });

  it('sends URLSearchParams as a form', () => {
    const { net, fetch } = setUp();
    void fetch('https://api.test/a', { method: 'POST', body: new URLSearchParams({ a: 'b c' }) });
    assert.equal(net.sent[0]!.data, 'a=b+c');
    assert.match(net.sent[0]!.headers['content-type']!, /^application\/x-www-form-urlencoded/);
  });

  it('takes the method, headers and url from a Request', () => {
    const { net, fetch } = setUp();
    void fetch(new Request('https://api.test/r', { method: 'PUT', headers: { A: '1' } }));
    assert.equal(net.sent[0]!.method, 'PUT');
    assert.equal(net.sent[0]!.url, 'https://api.test/r');
    assert.equal(net.sent[0]!.headers['a'], '1');
  });

  it('resolves at the headers, then streams each chunk as it arrives', async () => {
    const { net, fetch } = setUp();
    const pending = fetch('https://api.test/stream');
    net.respond(1, 200, { 'Content-Type': 'text/event-stream' }, 'https://api.test/stream');
    const response = await pending;
    assert.equal(response.status, 200);
    assert.equal(response.ok, true);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    assert.equal(response.url, 'https://api.test/stream');
    assert.equal(response.redirected, false);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const first = reader.read();
    net.chunk(1, 'data: 1\n');
    const one = await first;
    assert.equal(decoder.decode(one.value), 'data: 1\n');
    assert.equal(response.bodyUsed, true);

    net.chunk(1, 'data: é\n');
    const two = await reader.read();
    assert.deepEqual([...two.value!], [...new TextEncoder().encode('data: é\n')]);

    net.complete(1);
    assert.equal((await reader.read()).done, true);
  });

  it('reads the whole body with text(), json() and arrayBuffer()', async () => {
    const { net, fetch } = setUp();
    const texts = [fetch('https://a/1'), fetch('https://a/2'), fetch('https://a/3')];
    for (const id of [1, 2, 3]) {
      net.respond(id, 201, { 'content-type': 'application/json' });
      net.chunk(id, '{"name":');
      net.chunk(id, '"Adé"}');
      net.complete(id);
    }
    const [a, b, c] = await Promise.all(texts);
    assert.equal(await a!.text(), '{"name":"Adé"}');
    assert.deepEqual(await b!.json(), { name: 'Adé' });
    const buffer = await c!.arrayBuffer();
    assert.equal(new TextDecoder().decode(buffer), '{"name":"Adé"}');
    assert.equal(buffer.byteLength, 15);
  });

  it('reads a binary body byte-exact, in chunks of any length, through body and arrayBuffer()', async () => {
    const { net, fetch } = setUp();
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const pending = [fetch('https://a/png'), fetch('https://a/png')];
    for (const id of [1, 2]) {
      net.respond(id, 200, { 'content-type': 'image/png' });
      for (let at = 0, size = 1; at < bytes.length; at += size, size = (size % 7) + 1) {
        net.chunk(id, bytes.subarray(at, at + size));
      }
      net.complete(id);
    }
    const [a, b] = await Promise.all(pending);
    assert.deepEqual(new Uint8Array(await a!.arrayBuffer()), bytes);
    const reader = b!.body!.getReader();
    const read: number[] = [];
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      read.push(...next.value);
    }
    assert.deepEqual(read, [...bytes]);
  });

  it('decodes text split inside a character', async () => {
    const { net, fetch } = setUp();
    const pending = fetch('https://a/t');
    net.respond(1, 200, { 'content-type': 'text/plain' });
    const encoded = new TextEncoder().encode('Adé!');
    net.chunk(1, encoded.subarray(0, 3));
    net.chunk(1, encoded.subarray(3));
    net.complete(1);
    assert.equal(await (await pending).text(), 'Adé!');
  });

  it('reads a body a host sends whole, as base64, at the end', async () => {
    const { net, fetch } = setUp();
    const pending = fetch('https://a/whole');
    net.respond(1, 200, { 'content-type': 'application/octet-stream' });
    net.emit('didReceiveNetworkData', 1, Buffer.from([0, 255, 128, 7]).toString('base64'));
    net.complete(1);
    assert.deepEqual([...new Uint8Array(await (await pending).arrayBuffer())], [0, 255, 128, 7]);
  });

  it('refuses a second read of the same body', async () => {
    const { net, fetch } = setUp();
    const pending = fetch('https://a/');
    net.respond(1);
    net.chunk(1, 'x');
    net.complete(1);
    const response = await pending;
    assert.equal(response.bodyUsed, false);
    assert.equal(await response.text(), 'x');
    assert.equal(response.bodyUsed, true);
    await assert.rejects(response.text(), TypeError);
  });

  it('reads a clone and the original separately', async () => {
    const { net, fetch } = setUp();
    const pending = fetch('https://a/');
    net.respond(1, 200, { 'x-a': '1' });
    const response = await pending;
    const copy = response.clone();
    net.chunk(1, 'ab');
    net.complete(1);
    assert.equal(await copy.text(), 'ab');
    assert.equal(await response.text(), 'ab');
    assert.equal(copy.headers.get('x-a'), '1');
  });

  it('keeps events that arrive before the request id, and drops other requests', async () => {
    const { net, fetch } = setUp();
    net.idLate = true;
    const pending = fetch('https://a/');
    net.respond(7, 500);
    net.respond(1, 200);
    net.chunk(7, 'other');
    net.chunk(1, 'mine');
    net.complete(1);
    net.sent[0]!.giveId();
    const response = await pending;
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'mine');
  });

  it('ignores another request after the id is known', async () => {
    const { net, fetch } = setUp();
    const first = fetch('https://a/1');
    const second = fetch('https://a/2');
    net.respond(2, 404);
    net.respond(1, 200);
    net.chunk(2, 'two');
    net.chunk(1, 'one');
    net.complete(1);
    net.complete(2);
    assert.equal((await first).status, 200);
    assert.equal(await (await first).text(), 'one');
    assert.equal((await second).ok, false);
    assert.equal(await (await second).text(), 'two');
  });

  it('rejects with a TypeError when the request fails before its headers', async () => {
    const { net, fetch } = setUp();
    const pending = fetch('https://a/');
    net.complete(1, 'The Internet connection appears to be offline.');
    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof TypeError);
      assert.match(error.message, /offline/);
      return true;
    });
  });

  it('rejects with a TypeError on a timeout', async () => {
    const { net, fetch } = setUp();
    const pending = fetch('https://a/');
    net.complete(1, 'The request timed out.', true);
    await assert.rejects(pending, TypeError);
  });

  it('errors the body when the request fails part way', async () => {
    const { net, fetch } = setUp();
    const pending = fetch('https://a/');
    net.respond(1);
    net.chunk(1, 'part');
    const response = await pending;
    const text = response.text();
    net.complete(1, 'The network connection was lost.');
    await assert.rejects(text, /connection was lost/);
  });

  it('stops listening once the request completes', async () => {
    const { net, fetch } = setUp();
    const pending = fetch('https://a/');
    assert.ok(net.listening > 0);
    net.respond(1);
    net.complete(1);
    await (await pending).text();
    assert.equal(net.listening, 0);
  });

  it('has no body for HEAD or a 204', async () => {
    const { net, fetch } = setUp();
    const head = fetch('https://a/', { method: 'HEAD' });
    const empty = fetch('https://a/');
    net.respond(1);
    net.respond(2, 204);
    net.complete(1);
    net.complete(2);
    assert.equal((await head).body, null);
    assert.equal(await (await empty).text(), '');
  });

  it('marks a response from another URL as redirected', async () => {
    const { net, fetch } = setUp();
    const pending = fetch('https://a/old');
    net.respond(1, 200, {}, 'https://a/new');
    const response = await pending;
    assert.equal(response.url, 'https://a/new');
    assert.equal(response.redirected, true);
  });
});

describe('fetch on macOS, aborted', () => {
  it('rejects at once, and sends nothing, for a signal already aborted', async () => {
    const { net, fetch } = setUp();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(fetch('https://a/', { signal: controller.signal }), {
      name: 'AbortError',
    });
    assert.equal(net.sent.length, 0);
    assert.equal(net.listening, 0);
  });

  it('rejects with the reason and aborts the request before the headers', async () => {
    const { net, fetch } = setUp();
    const controller = new AbortController();
    const pending = fetch('https://a/', { signal: controller.signal });
    controller.abort(new Error('gone'));
    await assert.rejects(pending, /gone/);
    assert.deepEqual(net.aborted, [1]);
    assert.equal(net.listening, 0);
  });

  it('aborts the request once its id arrives when aborted before it', async () => {
    const { net, fetch } = setUp();
    net.idLate = true;
    const controller = new AbortController();
    const pending = fetch('https://a/', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.deepEqual(net.aborted, []);
    net.sent[0]!.giveId();
    assert.deepEqual(net.aborted, [1]);
  });

  it('errors the body and aborts the request after the headers', async () => {
    const { net, fetch } = setUp();
    const controller = new AbortController();
    const pending = fetch('https://a/', { signal: controller.signal });
    net.respond(1);
    const response = await pending;
    const text = response.text();
    net.chunk(1, 'part');
    controller.abort();
    await assert.rejects(text, { name: 'AbortError' });
    assert.deepEqual(net.aborted, [1]);
  });

  it('does not abort a request that has already completed', async () => {
    const { net, fetch } = setUp();
    const controller = new AbortController();
    const pending = fetch('https://a/', { signal: controller.signal });
    net.respond(1);
    net.chunk(1, 'done');
    net.complete(1);
    const response = await pending;
    controller.abort();
    await settle();
    assert.deepEqual(net.aborted, []);
    assert.equal(await response.text(), 'done');
  });

  it('does not abort a completed request when its body is cancelled', async () => {
    const { net, fetch } = setUp();
    const pending = fetch('https://a/');
    net.respond(1);
    net.chunk(1, 'unread');
    net.complete(1);
    await (await pending).body!.cancel();
    assert.deepEqual(net.aborted, []);
  });

  it('aborts the request when the body stream is cancelled', async () => {
    const { net, fetch } = setUp();
    const pending = fetch('https://a/');
    net.respond(1);
    const response = await pending;
    await response.body!.cancel();
    assert.deepEqual(net.aborted, [1]);
    assert.equal(net.listening, 0);
    assert.equal(response.bodyUsed, true);
  });
});

describe("fetch on macOS, under Angular's default HttpClient backend", () => {
  it('delivers a JSON body, which it reads through response.body', async () => {
    const original = globalThis.fetch;
    const net = new FakeNetworking();
    globalThis.fetch = createFetch(net);
    try {
      const mod = await compileFixture('fixtures/http.ts');
      const app = mount(1, mod['HttpHost'] as Type<unknown>, createFakeFabric(), {
        providers: [provideHttpClient()],
      });
      const http = (app.componentRef.instance as { http: HttpClient }).http;
      const body = firstValueFrom(http.get<{ name: string }>('https://api.test/user'));
      await settle();
      net.respond(1, 200, { 'Content-Type': 'application/json' }, 'https://api.test/user');
      net.chunk(1, '{"name":');
      net.chunk(1, '"Ada"}');
      net.complete(1);
      assert.deepEqual(await body, { name: 'Ada' });
      assert.equal(net.sent[0]!.url, 'https://api.test/user');
      app.componentRef.destroy();
    } finally {
      globalThis.fetch = original;
    }
  });
});
