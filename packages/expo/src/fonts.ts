/**
 * `Fonts`, bound to `expo-font`.
 *
 * A font on a phone is not fetched when the text engine first needs it. It has to be registered
 * with the platform up front, or the first paint is in the fallback face and reflows when the
 * real one lands - which is why the interesting call here is the one an app makes *before* it
 * mounts:
 *
 * ```ts
 * import { loadFonts } from '@ng-native/expo/fonts';
 *
 * await loadFonts(styleSheetOf(GlobalStyles));
 * mount(rootTag, App, getFabricUIManager(), { globalStyles: styleSheetOf(GlobalStyles) });
 * ```
 *
 * The class takes its platform rather than injecting it, because that call happens before there
 * is an injector to inject from. `inject(Fonts)` is for a screen that wants to ask what loaded.
 *
 * Unlike the other services here this goes through `expo-font`'s JavaScript rather than its
 * native module: the module takes descriptors the JS builds out of an asset, and rebuilding them
 * here would be copying out its internals rather than using it.
 */
import { InjectionToken, computed, signal, type Signal } from '@angular/core';
import {
  fontsLoading,
  fontsRegistered,
  fontsSettled,
  onFontsRegistered,
  registeredFaces,
} from '@ng-native/fabric';
import { expoModule, present } from './native.ts';
import { noteRegisteredNames } from './ui-font-names.ts';

/** A face a stylesheet declared, as the compiler collected it. */
export interface FontFace {
  readonly family: string;
  /** What `require('./Inter.ttf')` returned: an asset id, or a module the bundler resolved. */
  readonly source: unknown;
  readonly weight?: number;
  readonly style?: string;
  /** The name inside the face's file, which SwiftUI finds it by. Read by the build. */
  readonly postScriptName?: string;
}

/** Just enough of a compiled stylesheet to find the faces in it. */
export interface SheetWithFonts {
  readonly fonts?: readonly FontFace[];
}

/** The slice of `expo-font` this needs. */
export interface NativeFonts {
  loadAsync(map: Record<string, unknown>): Promise<void>;
  isLoaded(family: string): boolean;
  getLoadedFonts(): string[];
}

/**
 * Loading is by family name, which is also all native matches on.
 *
 * There is no weight matching on a device: `font-family: Inter` finds the face registered under
 * exactly that name, and a bold cut is a family of its own. A face that declares a weight or a
 * style is therefore registered under a composed name as well (`Inter-700`, `Inter-italic`,
 * `Inter-700-italic`), which is the name the engine points a matching text at.
 *
 * A face with both a weight and a style also answers to each alone, as it did before it had a
 * name of its own, but only where no face declared exactly that.
 */
export function registrationsFor(faces: readonly FontFace[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const [name, face] of registeredFaces(faces)) map[name] = face.source;
  return map;
}

export function expoFonts(): NativeFonts | null {
  const expo = expoModule('expo-font', () => require('expo-font') as typeof import('expo-font'));
  if (!expo) return null;
  // Missing, the stand-in itself: `available` reads false, and a load says what to install.
  if (!present(expo)) return expo as unknown as NativeFonts;
  return {
    loadAsync: (map) => expo.loadAsync(map as Parameters<typeof expo.loadAsync>[0]),
    isLoaded: (family) => expo.isLoaded(family),
    getLoadedFonts: () => expo.getLoadedFonts(),
  };
}

/**
 * Bumped whenever faces are registered, by any registry.
 *
 * The platform's own list is a plain array that changes underneath us, so a template binding to
 * it would render once and never again - and the one moment it changes is exactly the moment a
 * screen waiting on a font wants to hear about. This makes both readers reactive without
 * mirroring the list. Shared by every registry, because `loadFonts()` registers through its own
 * and a screen reads through the injected one.
 */
const generation = signal(0);
onFontsRegistered(() => generation.update((n) => n + 1));

export class FontRegistry {
  private readonly native: NativeFonts | null;

  constructor(native: NativeFonts | null) {
    this.native = native;
  }

  /** Whether `expo-font` is installed at all. Without it a custom face simply never appears. */
  get available(): boolean {
    return present(this.native) !== null;
  }

  /** Every family the platform can currently find, custom or bundled. */
  readonly families: Signal<readonly string[]> = computed(() => {
    generation();
    return this.native?.getLoadedFonts() ?? [];
  });

  /** Whether a family is registered. Reactive: re-read after a `load` that adds one. */
  has(family: string): boolean {
    generation();
    return this.native?.isLoaded(family) ?? false;
  }

  /**
   * Register every `@font-face` a compiled sheet declares.
   *
   * Called before `mount` in an app that uses one. Text laid out before a face registers is in
   * the fallback face until it does, and is laid out again then. Sheets with no faces resolve
   * immediately, so calling it unconditionally at bootstrap costs nothing.
   */
  async loadSheet(...sheets: readonly (SheetWithFonts | null | undefined)[]): Promise<void> {
    const faces = sheets.flatMap((sheet) => [...(sheet?.fonts ?? [])]);
    if (!faces.length) return;
    await this.load(registrationsFor(faces));
  }

  /** Register faces by name, for a font that did not come from a stylesheet. */
  async load(map: Record<string, unknown>): Promise<void> {
    const native = this.native;
    if (!native) return;
    // Before the first await, so text the app lays out meanwhile waits for the face by name.
    const families = Object.keys(map);
    fontsLoading(families);
    try {
      await native.loadAsync(map);
    } finally {
      fontsSettled(families);
      // Text already laid out in the fallback face keeps it until it is laid out again. Only the
      // faces that registered: one failing fails the whole load, not the others in it.
      const registered = families.filter((family) => native.isLoaded(family));
      noteRegisteredNames(registered);
      fontsRegistered(registered);
    }
  }
}

/** Injected where an app wants to ask what is loaded. */
export const Fonts = new InjectionToken<FontRegistry>('angular-native.fonts', {
  factory: () => new FontRegistry(expoFonts()),
});
export type Fonts = FontRegistry;

/**
 * Register every face the given sheets declare, before the app mounts.
 *
 * A function rather than a service because that is when it is needed: there is no injector yet.
 *
 * A missing `expo-font` rejects the promise rather than throwing, so a caller's `.catch` can mount
 * the app in the fallback face. Sheets that declare no face resolve without reaching for it.
 */
export async function loadFonts(
  ...sheets: readonly (SheetWithFonts | null | undefined)[]
): Promise<void> {
  if (typeof __DEV__ !== 'undefined' && __DEV__) warnIfASheetIsNull(sheets);
  if (!sheets.some((sheet) => sheet?.fonts?.length)) return;
  await new FontRegistry(expoFonts()).loadSheet(...sheets);
}

declare const __DEV__: boolean | undefined;

let warnedSheetNull = false;

/**
 * A `null` sheet is what a lookup that failed hands over - `styleSheetOf()` on a class with no
 * compiled sheet - so its faces never load and nothing says why. `undefined` is left alone, as an
 * optional sheet. Said once, in development.
 */
function warnIfASheetIsNull(sheets: readonly (SheetWithFonts | null | undefined)[]): void {
  if (warnedSheetNull || !sheets.includes(null)) return;
  warnedSheetNull = true;
  console.warn(
    '[angular-native] loadFonts() was given a null sheet, so no @font-face from it is loaded. ' +
      'A null there is what styleSheetOf() returns for a class with no compiled sheet.',
  );
}
