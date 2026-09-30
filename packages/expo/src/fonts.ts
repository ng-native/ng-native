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
import { fontsRegistered } from '@ng-native/fabric';
import { expoModule } from './native.ts';

/** A face a stylesheet declared, as the compiler collected it. */
export interface FontFace {
  readonly family: string;
  /** What `require('./Inter.ttf')` returned: an asset id, or a module the bundler resolved. */
  readonly source: unknown;
  readonly weight?: number;
  readonly style?: string;
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
 * exactly that name, and a bold cut is a family of its own. A face that declares a weight is
 * therefore registered under a composed name as well as its own, so a stylesheet can say
 * `font-family: Inter-700` and get the file it declared - and a sheet that only ever registers
 * one weight per family needs to know none of this.
 */
export function registrationsFor(faces: readonly FontFace[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const face of faces) {
    map[face.family] ??= face.source;
    if (face.weight !== undefined) map[`${face.family}-${face.weight}`] = face.source;
    if (face.style) map[`${face.family}-${face.style}`] = face.source;
  }
  return map;
}

export function expoFonts(): NativeFonts | null {
  const expo = expoModule('expo-font', () => require('expo-font') as typeof import('expo-font'));
  if (!expo) return null;
  return {
    loadAsync: (map) => expo.loadAsync(map as Parameters<typeof expo.loadAsync>[0]),
    isLoaded: (family) => expo.isLoaded(family),
    getLoadedFonts: () => expo.getLoadedFonts(),
  };
}

export class FontRegistry {
  private readonly native: NativeFonts | null;
  /**
   * Bumped whenever faces are registered.
   *
   * The platform's own list is a plain array that changes underneath us, so a template binding to
   * it would render once and never again - and the one moment it changes is exactly the moment a
   * screen waiting on a font wants to hear about. This makes both readers reactive without
   * mirroring the list.
   */
  private readonly generation = signal(0);

  constructor(native: NativeFonts | null) {
    this.native = native;
  }

  /** Whether `expo-font` is installed at all. Without it a custom face simply never appears. */
  get available(): boolean {
    return this.native !== null;
  }

  /** Every family the platform can currently find, custom or bundled. */
  readonly families: Signal<readonly string[]> = computed(() => {
    this.generation();
    return this.native?.getLoadedFonts() ?? [];
  });

  /** Whether a family is registered. Reactive: re-read after a `load` that adds one. */
  has(family: string): boolean {
    this.generation();
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
    try {
      await native.loadAsync(map);
    } finally {
      // Text already laid out in the fallback face keeps it until it is laid out again. Only the
      // faces that registered: one failing fails the whole load, not the others in it.
      fontsRegistered(Object.keys(map).filter((family) => native.isLoaded(family)));
    }
    this.generation.update((n) => n + 1);
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
 */
export function loadFonts(
  ...sheets: readonly (SheetWithFonts | null | undefined)[]
): Promise<void> {
  return new FontRegistry(expoFonts()).loadSheet(...sheets);
}
