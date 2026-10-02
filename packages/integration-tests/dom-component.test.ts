/**
 * The native half of `<dom-component>`: an Angular component for the browser, in a native web view, with its
 * inputs and outputs bound from the app's template.
 *
 * The page on the other side is stood in for by the messages it would post: `ready` with its
 * output names once mounted, `output` for each emit, `error` for anything it threw. What is
 * pinned is the app's end - the page it loads, the inputs it sends and when, and where each
 * message goes.
 */
import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ErrorHandler, type Type } from '@angular/core';
import { mount } from '@ng-native/platform';
import { createFakeFabric, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { DomComponent } from '@ng-native/expo/dom-component';
import { compileFixture } from './compile.ts';

interface Fixture {
  label: { set(value: string): void };
  sent: unknown[];
  outputs: { set(value: Record<string, (value: never) => void>): void };
}

describe('a DOM component in the app', () => {
  let Fixture: Type<unknown>;
  let fabric: FakeFabric;
  let app: ReturnType<typeof mount>;
  let fixture: Fixture;
  let injected: { tag: number; script: string }[];
  let errors: unknown[];
  const view = (): FakeFabricNode => fabric.committed[0]!.children[0]!;
  const settle = async () => {
    app.applicationRef.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  /** The URL the web view reports for its own page: the one it was told to load. */
  const page = 'http://192.168.1.5:8081/_expo/@dom/note.ts?file=file:///app/web/note.ts';
  /** `null` for no URL at all, as no version of the web view sends but a message could lack. */
  const postRaw = async (data: string, url: string | null = page) => {
    fabric.emit(view(), 'topMessage', url === null ? { data } : { data, url });
    await settle();
  };
  const post = (message: unknown, url?: string | null) => postRaw(JSON.stringify(message), url);

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/dom-component.ts', import.meta.url)),
    );
    Fixture = mod['DomComponentFixture'] as Type<unknown>;
  });

  beforeEach(async () => {
    injected = [];
    errors = [];
    fabric = createFakeFabric();
    app = mount(1, Fixture, fabric, {
      providers: [
        { provide: ErrorHandler, useValue: { handleError: (e: unknown) => errors.push(e) } },
        {
          provide: DomComponent.SOURCE,
          useValue: {
            baseUrl: 'http://192.168.1.5:8081/_expo/@dom',
            functions: {
              async injectJavaScript(this: { nativeTag: number }, script: string) {
                injected.push({ tag: this.nativeTag, script });
              },
            },
          },
        },
      ],
    });
    fixture = app.componentRef.instance as Fixture;
    await settle();
  });

  const sentInputs = () =>
    injected
      .map(({ script }) => /receive\((.*)\)/.exec(script)?.[1])
      .map((json) => JSON.parse(json!));

  it("commits as Expo's DOM web view", () => {
    assert.equal(view().viewName, 'ViewManagerAdapter_ExpoDomWebViewModule');
  });

  it("loads its page from where Expo keeps DOM components' pages", () => {
    // The dev server here; `www.bundle` in the app, or an update's directory, in a release build.
    assert.deepEqual(view().props['source'], {
      uri: 'http://192.168.1.5:8081/_expo/@dom/note.ts?file=file:///app/web/note.ts',
    });
  });

  it('hands the page its inputs before it loads', () => {
    assert.deepEqual(JSON.parse(view().props['injectedJavaScriptObject'] as string), {
      inputs: { label: 'Draft' },
    });
  });

  it('sends the inputs again once the page is ready, in case they changed while it loaded', async () => {
    fixture.label.set('Changed while loading');
    await settle();
    assert.equal(injected.length, 0, 'nothing to send them to yet');
    await post({ type: 'ready', outputs: ['sent'] });
    assert.deepEqual(sentInputs(), [
      { type: 'inputs', inputs: { label: 'Changed while loading' } },
    ]);
    assert.equal(injected[0]!.tag, view().reactTag, 'to this web view');
  });

  it('sends a changed input without reloading the page', async () => {
    await post({ type: 'ready', outputs: ['sent'] });
    const page = view().props['injectedJavaScriptObject'];
    fixture.label.set('Final');
    await settle();
    assert.deepEqual(sentInputs().at(-1), { type: 'inputs', inputs: { label: 'Final' } });
    assert.equal(view().props['injectedJavaScriptObject'], page, 'the same page');
  });

  it("calls the app's handler when the page emits", async () => {
    await post({ type: 'ready', outputs: ['sent'] });
    await post({ type: 'output', name: 'sent', value: 'Hello' });
    assert.deepEqual(fixture.sent, ['Hello']);
  });

  it('names the outputs the page has when given a handler for one it does not', async () => {
    fixture.outputs.set({ nope: () => {} });
    await settle();
    await post({ type: 'ready', outputs: ['sent', 'textChange'] });
    assert.match(
      String(errors[0]),
      /note\.ts has no output 'nope' \(its outputs: sent, textChange\)/,
    );
  });

  it("hands the page's errors to the app's ErrorHandler", async () => {
    await post({ type: 'error', message: 'the note failed' });
    assert.match(String(errors[0]), /note\.ts.*the note failed/);
  });

  /**
   * The web view reports every message with the URL of the page it is showing. A link in rendered
   * content can take it to another page, which the native side must not treat as the component.
   */
  describe('a message from a page other than its own', () => {
    it('fires no output and gets no inputs', async () => {
      await post({ type: 'ready', outputs: ['sent'] }, 'https://evil.example/note.ts');
      assert.equal(injected.length, 0, 'the inputs stay in the app');
      await post({ type: 'output', name: 'sent', value: 'forged' }, 'https://evil.example/');
      assert.deepEqual(fixture.sent, []);
      assert.deepEqual(errors, []);
    });

    it('is ignored when the web view names no page at all', async () => {
      await post({ type: 'ready', outputs: ['sent'] }, '');
      await post({ type: 'output', name: 'sent', value: 'forged' }, null);
      assert.equal(injected.length, 0);
      assert.deepEqual(fixture.sent, []);
    });

    it("is ignored from a server whose origin only starts with the dev server's", async () => {
      // 80811 is another port, as `https://abc.exp.direct.evil.com` is another tunnel's host.
      await post({ type: 'ready', outputs: ['sent'] }, 'http://192.168.1.5:80811/note.ts');
      await post({ type: 'output', name: 'sent', value: 'forged' }, 'http://192.168.1.5:80811/');
      assert.equal(injected.length, 0);
      assert.deepEqual(fixture.sent, []);
    });

    it('is heard from anywhere on the dev server that serves its page', async () => {
      await post({ type: 'ready', outputs: ['sent'] }, `${page}#section`);
      await post({ type: 'output', name: 'sent', value: 'Hi' }, 'http://192.168.1.5:8081/x');
      assert.deepEqual(fixture.sent, ['Hi'], 'the dev server is the app');
      assert.equal(injected.length, 1);
    });
  });

  it('drops a message that is not JSON, without throwing', async () => {
    await postRaw('not json {');
    assert.deepEqual(errors, []);
    assert.equal(injected.length, 0);
  });

  it("does nothing for an output named after an object's own members", async () => {
    await post({ type: 'ready', outputs: ['sent'] });
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      await post({ type: 'output', name, value: 'x' });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(fixture.sent, []);
  });
});

/** A release build loads the page from a file the app ships, which iOS names relative to it. */
describe('a DOM component in a release build', () => {
  let Fixture: Type<unknown>;

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/dom-component.ts', import.meta.url)),
    );
    Fixture = mod['DomComponentFixture'] as Type<unknown>;
  });

  const run = async (baseUrl: string, url: string) => {
    const fabric = createFakeFabric();
    const app = mount(1, Fixture, fabric, {
      providers: [{ provide: DomComponent.SOURCE, useValue: { baseUrl, functions: null } }],
    });
    app.applicationRef.tick();
    const fixture = app.componentRef.instance as Fixture;
    const data = JSON.stringify({ type: 'output', name: 'sent', value: 'Hi' });
    fabric.emit(fabric.committed[0]!.children[0]!, 'topMessage', { data, url });
    app.applicationRef.tick();
    return fixture.sent;
  };

  it('hears its page from the file the web view resolved', async () => {
    const ios = 'file:///private/var/containers/Bundle/Application/A1/App.app/www.bundle/note.ts';
    assert.deepEqual(await run('www.bundle', ios), ['Hi'], 'iOS, relative to the app');
    assert.deepEqual(
      await run('file:///android_asset/www.bundle', 'file:///android_asset/www.bundle/note.ts'),
      ['Hi'],
      'Android',
    );
  });

  it('ignores any other page', async () => {
    assert.deepEqual(await run('www.bundle', 'https://evil.example/www.bundle/note.ts'), []);
    assert.deepEqual(await run('www.bundle', 'file:///App.app/www.bundle/other.html'), []);
  });
});
