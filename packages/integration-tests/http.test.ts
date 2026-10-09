/**
 * `HttpClient` on a device, through `provideNativeHttpClient`.
 *
 * Angular's default backend is `fetch`, and it reads a body only through `response.body`'s
 * stream. React Native's `fetch` is `whatwg-fetch` over XHR, whose `Response` has no `body`, so the
 * default hands back `null` for every response without an error. These run against a stand-in
 * `XMLHttpRequest` shaped like RN's, which is what the helper routes requests through instead.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import type { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { mount } from '@ng-native/platform';
import { provideNativeHttpClient } from '@ng-native/platform/http';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Sent {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

/** The part of RN's `XMLHttpRequest` Angular's `HttpXhrBackend` touches. */
class FakeXhr {
  static sent: Sent[] = [];
  static reply: { status: number; body: string; type?: string } = { status: 200, body: '' };

  readyState = 0;
  status = 0;
  statusText = '';
  responseType = '';
  response: unknown = null;
  responseText = '';
  responseURL = '';
  withCredentials = false;
  private listeners: Record<string, ((e: unknown) => void)[]> = {};
  private request: Sent = { method: '', url: '', body: null, headers: {} };

  open(method: string, url: string): void {
    this.request = { method, url, body: null, headers: {} };
  }
  setRequestHeader(name: string, value: string): void {
    this.request.headers[name.toLowerCase()] = value;
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  getAllResponseHeaders(): string {
    return `content-type: ${FakeXhr.reply.type ?? 'application/json'}\r\n`;
  }
  abort(): void {}
  send(body: unknown): void {
    FakeXhr.sent.push({ ...this.request, body });
    setTimeout(() => {
      const { status, body: text } = FakeXhr.reply;
      this.readyState = 4;
      this.status = status;
      this.responseURL = this.request.url;
      this.responseText = text;
      this.response = this.responseType === 'json' ? JSON.parse(text) : text;
      for (const fn of this.listeners['load'] ?? []) fn({ type: 'load' });
    });
  }
}

describe('provideNativeHttpClient', () => {
  let http: HttpClient;
  const original = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;

  before(async () => {
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
    const mod = await compileFixture('fixtures/http.ts');
    const app = mount(1, mod['HttpHost'] as Type<unknown>, createFakeFabric(), {
      providers: [provideNativeHttpClient()],
    });
    http = (app.componentRef.instance as { http: HttpClient }).http;
  });

  after(() => {
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = original;
  });

  it('delivers a JSON body, which the default fetch backend would drop on RN', async () => {
    FakeXhr.reply = { status: 200, body: '{"name":"Ada"}' };
    const body = await firstValueFrom(http.get<{ name: string }>('https://api.test/user'));
    assert.deepEqual(body, { name: 'Ada' });
    assert.equal(FakeXhr.sent.at(-1)?.url, 'https://api.test/user');
  });

  it('sends a JSON body with its content type', async () => {
    FakeXhr.reply = { status: 201, body: '{}' };
    await firstValueFrom(http.post('https://api.test/user', { name: 'Ada' }));
    const sent = FakeXhr.sent.at(-1)!;
    assert.equal(sent.method, 'POST');
    assert.equal(sent.body, '{"name":"Ada"}');
    assert.match(sent.headers['content-type'] ?? '', /application\/json/);
  });

  it('reports an error status as an HttpErrorResponse carrying the body', async () => {
    FakeXhr.reply = { status: 404, body: '{"error":"missing"}' };
    await assert.rejects(firstValueFrom(http.get('https://api.test/nope')), (error: unknown) => {
      const e = error as { status: number; error: unknown };
      assert.equal(e.status, 404);
      assert.deepEqual(e.error, { error: 'missing' });
      return true;
    });
  });
});
