/**
 * `TextRecognition`: the text in an image, line by line, from this package's native half.
 *
 * ```ts
 * private readonly ocr = inject(TextRecognition);
 *
 * const { text, lines } = await this.ocr.recognize(photo.uri, { languages: ['en-GB'] });
 * ```
 *
 * On iOS it is Vision's `VNRecognizeTextRequest`, which runs on the device, offline, and does
 * not need Apple Intelligence.
 *
 * Expo Go cannot load native code of its own, Android has no recognizer yet, and Node has none,
 * so there `available` is false and `recognize` rejects with a `MissingModuleError`.
 */
import { InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import { MissingModuleError, currentPlatform, optional } from './native.ts';

export interface TextRecognitionOptions {
  /**
   * The languages to read, most likely first, as BCP 47 codes (`en-GB`, `fr-FR`). Left out,
   * Vision detects the language. A code Vision does not list reads as the first variant of the
   * same language it does (`en-GB` as `en-US`); a language it has no variant of rejects the call.
   * Chinese and Cantonese go by script: `zh-TW`, `zh-HK` and `zh-MO` read Traditional, other
   * regions Simplified, and a script in the code (`zh-Hant`) wins.
   */
  readonly languages?: readonly string[];
  /** `accurate` (the default) reads more, more slowly. `fast` suits a live preview. */
  readonly level?: 'accurate' | 'fast';
}

/** A rectangle in the image's pixels, from its top left corner, the right way up. */
export interface TextBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One line of text as Vision read it. */
export interface RecognizedLine {
  readonly text: string;
  /** How sure Vision is, from 0 to 1. */
  readonly confidence: number;
  readonly box: TextBox;
}

/** What `recognize` found in an image. */
export interface RecognizedText {
  /** Every line, in reading order, one to a line. Empty when there is no text. */
  readonly text: string;
  readonly lines: readonly RecognizedLine[];
  /** The image's size in pixels, the right way up, which the boxes are measured in. */
  readonly width: number;
  readonly height: number;
}

/** This package's native text recognition module. A test provides a stand-in. */
export interface NativeTextRecognition {
  recognize(imageUri: string, options: TextRecognitionOptions): Promise<RecognizedText>;
}

const MODULE = 'NgNativeTextRecognition';

/** The module where the build has it. */
function nativeTextRecognition(): NativeTextRecognition | null {
  return optional(
    () =>
      (globalThis as { expo?: { modules?: Record<string, NativeTextRecognition | undefined> } })
        .expo?.modules?.[MODULE] ?? null,
  );
}

@Service()
export class TextRecognition {
  /** Overridden in a test to read fixed text, or nothing. */
  static readonly SOURCE = new InjectionToken<NativeTextRecognition | null>(
    'angular-native.textRecognitionSource',
    { factory: nativeTextRecognition },
  );

  private readonly native = inject(TextRecognition.SOURCE);

  /** Whether `recognize` can run here: an iOS development or release build. */
  readonly available: Signal<boolean> = signal(this.native !== null).asReadonly();

  /**
   * The text in the image at `imageUri`, a `file://` URI such as the camera, the image picker or
   * a downloaded asset gives. Rejects when the image cannot be read.
   */
  recognize(imageUri: string, options: TextRecognitionOptions = {}): Promise<RecognizedText> {
    if (!this.native) return Promise.reject(missing());
    const languages = options.languages?.map(byScript);
    return this.native.recognize(imageUri, languages ? { ...options, languages } : options);
  }
}

/** The languages Vision lists by script rather than by region: `zh-Hant`, `yue-Hans`. */
const SCRIPTED = new Set(['zh', 'yue']);

/** Where Chinese is written in Traditional characters. */
const TRADITIONAL = new Set(['TW', 'HK', 'MO']);

/**
 * `code` as Vision names it. Chinese and Cantonese are named by script: one the code gives wins,
 * and otherwise Taiwan, Hong Kong and Macau write Traditional and the rest Simplified. Vision
 * would match `zh-TW` to the first Chinese it lists, which is Simplified.
 */
function byScript(code: string): string {
  const [language = '', ...rest] = code.split('-');
  const lower = language.toLowerCase();
  if (!SCRIPTED.has(lower)) return code;
  const script = rest.find((part) => /^[a-z]{4}$/i.test(part));
  if (script) return `${lower}-${script[0]!.toUpperCase()}${script.slice(1).toLowerCase()}`;
  const traditional = rest.some((part) => TRADITIONAL.has(part.toUpperCase()));
  return `${lower}-${traditional ? 'Hant' : 'Hans'}`;
}

function missing(): MissingModuleError {
  const platform = currentPlatform();
  const where =
    platform === null
      ? 'Node, where a test runs, has no native module: provide TextRecognition.SOURCE with a stand-in.'
      : platform === 'ios'
        ? 'This build does not have it, and Expo Go cannot load it: run a development build.'
        : `It is not available on ${platform}.`;
  return new MissingModuleError(
    '@ng-native/expo',
    platform ?? 'web',
    undefined,
    `[angular-native] TextRecognition is native code of @ng-native/expo. ${where}`,
  );
}
