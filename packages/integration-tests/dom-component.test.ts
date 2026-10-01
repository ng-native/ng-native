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
  const post = async (message: unknown) => {
    fabric.emit(view(), 'topMessage', { data: JSON.stringify(message) });
    await settle();
  };

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
});
