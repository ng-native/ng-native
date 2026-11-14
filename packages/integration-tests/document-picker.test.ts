/**
 * `DocumentPicker`, over a fake of `expo-document-picker` that records every call.
 *
 * The options are the module's own, passed through unchanged; a cancelled picker answers with no
 * files rather than a result to unwrap.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DocumentPicker,
  type NativeDocumentPicker,
  type PickedDocument,
} from '@ng-native/expo/document-picker';
import { serviceWith } from './injected.ts';

const file: PickedDocument = {
  uri: 'file:///cache/report.pdf',
  name: 'report.pdf',
  mimeType: 'application/pdf',
  size: 1024,
  lastModified: 0,
};

function platform(result: { canceled: boolean; assets: PickedDocument[] | null }) {
  const calls: unknown[][] = [];
  const native = {
    getDocumentAsync: async (...args: unknown[]) => (
      calls.push(['getDocumentAsync', ...args]),
      result
    ),
  } as unknown as NativeDocumentPicker;
  return Object.assign(native, { calls });
}

const serviceOn = (native: NativeDocumentPicker | null) =>
  serviceWith(DocumentPicker.SOURCE, native, () => new DocumentPicker());

describe('document picker', () => {
  it('reaches getDocumentAsync with its options, and hands back the files picked', async () => {
    const native = platform({ canceled: false, assets: [file] });
    const picked = await serviceOn(native).pick({ type: 'application/pdf', multiple: true });
    assert.deepEqual(picked, [file]);
    assert.deepEqual(native.calls, [
      ['getDocumentAsync', { type: 'application/pdf', multiple: true }],
    ]);
  });

  it('answers no files when the picker is cancelled', async () => {
    assert.deepEqual(await serviceOn(platform({ canceled: true, assets: null })).pick(), []);
  });

  it('is inert rather than broken with no module installed', async () => {
    assert.deepEqual(await serviceOn(null).pick(), []);
  });
});

/** A folder that records the files made in it, each of which records what is written to it. */
function folder(uri = 'file:///picked/') {
  const made: { name: string; mimeType: string | null; written: (string | Uint8Array)[] }[] = [];
  return {
    made,
    uri,
    createFile(name: string, mimeType: string | null) {
      const file = { name, mimeType, written: [] as (string | Uint8Array)[] };
      made.push(file);
      return {
        uri: `${uri}${name}`,
        exists: true,
        size: 0,
        create: () => {},
        write: (content: string | Uint8Array) => void file.written.push(content),
        writeSync: (content: string | Uint8Array) => void file.written.push(content),
        text: async () => '',
        textSync: () => '',
        bytes: async () => new Uint8Array(),
        delete: () => {},
      };
    },
  };
}

const cancelled = (code: string) => Promise.reject(Object.assign(new Error('cancelled'), { code }));

describe('picking a folder', () => {
  it('answers the folder the user picked', async () => {
    const picked = folder();
    const native = {
      ...platform({ canceled: true, assets: null }),
      pickDirectoryAsync: async () => picked,
    };
    assert.equal(await serviceOn(native).pickDirectory(), picked);
  });

  it('answers null when the user dismisses it, on Android and iOS, and rethrows anything else', async () => {
    for (const code of ['ERR_PICKER_CANCELLED', 'ERR_FILE_PICKING_CANCELLED']) {
      const native = {
        ...platform({ canceled: true, assets: null }),
        pickDirectoryAsync: () => cancelled(code),
      };
      assert.equal(await serviceOn(native).pickDirectory(), null, code);
    }
    const failure = Object.assign(new Error('denied'), { code: 'ERR_UNABLE_TO_CREATE' });
    const native = {
      ...platform({ canceled: true, assets: null }),
      pickDirectoryAsync: () => Promise.reject(failure),
    };
    await assert.rejects(serviceOn(native).pickDirectory(), (error) => error === failure);
  });

  it('answers null where there is no folder picker, or no module', async () => {
    assert.equal(await serviceOn(platform({ canceled: true, assets: null })).pickDirectory(), null);
    assert.equal(await serviceOn(null).pickDirectory(), null);
  });
});

describe('saving a file where the user chooses', () => {
  it('writes the contents into a file in the folder the user picks, and answers where', async () => {
    const picked = folder();
    const native = {
      ...platform({ canceled: true, assets: null }),
      pickDirectoryAsync: async () => picked,
    };
    const saved = await serviceOn(native).save({
      suggestedName: 'export.csv',
      contents: 'a,b',
      types: ['text/csv'],
    });
    assert.equal(saved, 'file:///picked/export.csv');
    assert.deepEqual(picked.made, [{ name: 'export.csv', mimeType: 'text/csv', written: ['a,b'] }]);
  });

  it("copies another file's bytes when given one to save", async () => {
    const picked = folder();
    const native = {
      ...platform({ canceled: true, assets: null }),
      pickDirectoryAsync: async () => picked,
    };
    const bytes = new Uint8Array([1, 2, 3]);
    const saved = await serviceOn(native).save({
      suggestedName: 'photo.jpg',
      fromFile: { bytes: async () => bytes },
    });
    assert.equal(saved, 'file:///picked/photo.jpg');
    assert.deepEqual(picked.made, [{ name: 'photo.jpg', mimeType: null, written: [bytes] }]);
  });

  it("uses the platform's own save dialog where the source has one, which writes the file", async () => {
    const asked: unknown[] = [];
    const native = {
      ...platform({ canceled: true, assets: null }),
      pickDirectoryAsync: async () => assert.fail('no folder picker where there is a save dialog'),
      saveDocumentAsync: async (options: unknown) => (
        asked.push(options),
        'file:///Users/me/a.txt'
      ),
    };
    const saved = await serviceOn(native).save({ suggestedName: 'a.txt', contents: 'hi' });
    assert.equal(saved, 'file:///Users/me/a.txt');
    assert.deepEqual(asked, [{ suggestedName: 'a.txt', contents: 'hi', types: [] }]);
  });

  it('answers null when the user dismisses it, and where there is nowhere to save', async () => {
    const native = {
      ...platform({ canceled: true, assets: null }),
      pickDirectoryAsync: () => cancelled('ERR_PICKER_CANCELLED'),
    };
    assert.equal(await serviceOn(native).save({ suggestedName: 'a.txt', contents: '' }), null);
    const plain = platform({ canceled: true, assets: null });
    assert.equal(await serviceOn(plain).save({ suggestedName: 'a.txt', contents: '' }), null);
    assert.equal(await serviceOn(null).save({ suggestedName: 'a.txt', contents: '' }), null);
  });
});
