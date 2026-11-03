/**
 * `TextRecognition`: the text in an image, line by line.
 *
 * The native module stands in through `TextRecognition.SOURCE`. What is pinned is what reaches
 * it, what comes back from it, how `available` reads it, and what a build without it
 * says: Expo Go and Android, where it is not in the build, and Node, where a test provides one.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { MissingModuleError } from '@ng-native/expo';
import {
  TextRecognition,
  type NativeTextRecognition,
  type RecognizedText,
  type TextRecognitionOptions,
} from '@ng-native/expo/text-recognition';
import { cleanup, injectService } from '@ng-native/testing';

const RECEIPT: RecognizedText = {
  text: 'CORNER SHOP\nTotal 4.20',
  lines: [
    { text: 'CORNER SHOP', confidence: 1, box: { x: 40, y: 30, width: 300, height: 48 } },
    { text: 'Total 4.20', confidence: 0.5, box: { x: 40, y: 400, width: 220, height: 40 } },
  ],
  width: 600,
  height: 900,
};

function fakeNative() {
  const asked: { uri: string; options: TextRecognitionOptions }[] = [];
  const native: NativeTextRecognition = {
    recognize: async (uri, options) => {
      asked.push({ uri, options });
      return RECEIPT;
    },
  };
  return { native, asked };
}

const withSource = (native: NativeTextRecognition | null) =>
  injectService(TextRecognition, {
    providers: [{ provide: TextRecognition.SOURCE, useValue: native }],
  });

afterEach(() => {
  cleanup();
  delete (globalThis as Record<string, unknown>)['require'];
});

describe('TextRecognition', () => {
  it('reads an image through the native module, with the options given', async () => {
    const fake = fakeNative();
    const ocr = withSource(fake.native);
    const options = { languages: ['en-GB'], level: 'fast' } as const;
    assert.deepEqual(await ocr.recognize('file:///photo.jpg', options), RECEIPT);
    assert.deepEqual(fake.asked, [{ uri: 'file:///photo.jpg', options }]);
  });

  it('passes no options when none are given, so the native defaults apply', async () => {
    const fake = fakeNative();
    await withSource(fake.native).recognize('file:///photo.jpg');
    assert.deepEqual(fake.asked[0]!.options, {});
  });

  it('asks for Chinese and Cantonese by script, which is how Vision lists them', async () => {
    const fake = fakeNative();
    const asked = {
      'zh-TW': 'zh-Hant',
      'zh-HK': 'zh-Hant',
      'zh-MO': 'zh-Hant',
      'zh-tw': 'zh-Hant',
      'ZH-TW': 'zh-Hant',
      'zh-HANT': 'zh-Hant',
      'zh-cmn-TW': 'zh-Hant',
      'zh-CN': 'zh-Hans',
      'zh-SG': 'zh-Hans',
      zh: 'zh-Hans',
      'zh-Hant': 'zh-Hant',
      'zh-hant': 'zh-Hant',
      'zh-Hant-CN': 'zh-Hant',
      'zh-Hans-TW': 'zh-Hans',
      'yue-HK': 'yue-Hant',
      yue: 'yue-Hans',
      'en-GB': 'en-GB',
      'sr-Latn': 'sr-Latn',
    };
    await withSource(fake.native).recognize('file:///photo.jpg', {
      languages: Object.keys(asked),
      level: 'fast',
    });
    assert.deepEqual(fake.asked[0]!.options, {
      languages: Object.values(asked),
      level: 'fast',
    });
  });

  it('is available with the module', () => {
    assert.equal(withSource(fakeNative().native).available(), true);
  });

  it('passes a native rejection through', async () => {
    const failure = new Error('The image could not be read');
    const ocr = withSource({ recognize: () => Promise.reject(failure) });
    await assert.rejects(ocr.recognize('file:///missing.jpg'), failure);
  });
});

describe('TextRecognition without its native module', () => {
  it('is unavailable, and rejects in Node, saying to provide a stand-in', async () => {
    const ocr = injectService(TextRecognition);
    assert.equal(ocr.available(), false);
    const inNode = (error: Error) =>
      error instanceof MissingModuleError &&
      /TextRecognition\.SOURCE/.test(error.message) &&
      !/development build/.test(error.message);
    await assert.rejects(ocr.recognize('file:///photo.jpg'), inNode);
  });

  for (const [platform, expected] of [
    ['ios', /Expo Go cannot load it: run a development build/],
    ['android', /not available on android/],
  ] as const) {
    it(`says what is missing on ${platform}`, async () => {
      (globalThis as Record<string, unknown>)['require'] = (id: string) => {
        if (id === 'react-native') return { Platform: { OS: platform } };
        throw new Error(`Cannot find module '${id}'`);
      };
      const ocr = injectService(TextRecognition);
      assert.equal(ocr.available(), false);
      await assert.rejects(
        ocr.recognize('file:///photo.jpg'),
        (error: Error) =>
          error instanceof MissingModuleError &&
          error.module === '@ng-native/expo' &&
          expected.test(error.message),
      );
    });
  }
});
