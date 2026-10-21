/**
 * `document.execCommand('copy')`: the text of the field last selected goes to the clipboard of
 * Expo's native module, and an app without the module, or the command, is told so.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({
  selector: 'x-copy',
  template: `<input id="link" value="https://shop.example/" />
    <textarea id="note">Hello there</textarea>`,
})
class Copy {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

async function page(providers: unknown[] = [provideWebCompat()]) {
  const app = await render(Copy, { providers: providers as never });
  await settle();
  return app.instance.document as Dom;
}

/** Run with Expo's clipboard module as given (or none), put back after. */
async function withClipboard<T>(module: object | undefined, run: () => Promise<T>): Promise<T> {
  const scope = globalThis as { expo?: unknown };
  const had = 'expo' in scope;
  const before = scope.expo;
  scope.expo = module && { modules: { ExpoClipboard: module } };
  try {
    return await run();
  } finally {
    if (had) scope.expo = before;
    else delete scope.expo;
  }
}

describe("a document's copy command", () => {
  it('writes the text of the field last selected to the clipboard', async () => {
    const written: string[] = [];
    await withClipboard(
      { setStringAsync: async (text: string) => void written.push(text) },
      async () => {
        const document = await page();
        document.getElementById('link').select();
        assert.equal(document.execCommand('copy'), true);
        assert.deepEqual(written, ['https://shop.example/']);
        document.getElementById('note').select();
        assert.equal(document.execCommand('copy'), true);
        assert.deepEqual(written, ['https://shop.example/', 'Hello there']);
      },
    );
  });

  it('copies the text as it is when the command is given, and only the part selected', async () => {
    const written: string[] = [];
    await withClipboard(
      { setStringAsync: async (text: string) => void written.push(text) },
      async () => {
        const document = await page();
        const note = document.getElementById('note');
        note.select();
        note.value = 'Changed';
        document.execCommand('copy');
        note.select();
        note.setSelectionRange(0, 3);
        document.execCommand('copy');
        assert.deepEqual(written, ['Changed', 'Cha']);
      },
    );
  });

  it('answers false with no field selected, and for any other command', async () => {
    const written: string[] = [];
    await withClipboard(
      { setStringAsync: async (text: string) => void written.push(text) },
      async () => {
        const document = await page();
        assert.equal(document.execCommand('copy'), false, 'nothing selected');
        document.getElementById('link').select();
        assert.equal(document.execCommand('cut'), false);
        assert.equal(document.execCommand('selectAll'), false);
        assert.deepEqual(written, []);
      },
    );
  });

  it('answers false, and does not throw, with no clipboard module or no method on it', async () => {
    for (const module of [undefined, {}]) {
      await withClipboard(module, async () => {
        const document = await page();
        document.getElementById('link').select();
        assert.equal(document.execCommand('copy'), false);
      });
    }
  });

  it('is not troubled by a clipboard that fails', async () => {
    await withClipboard(
      {
        setStringAsync: async () => {
          throw new Error('denied');
        },
      },
      async () => {
        const document = await page();
        document.getElementById('link').select();
        assert.equal(document.execCommand('copy'), true);
        await settle();
      },
    );
  });

  it('is not on a document without provideWebCompat()', async () => {
    const document = await page([]);
    assert.equal(document.execCommand, undefined);
  });
});
