/**
 * A SwiftUI `font` modifier, given the name SwiftUI finds a face by.
 *
 * expo-font registers a face under the name the app gives it (`Brand-700`, as `loadFonts` names
 * the faces a stylesheet declares), and React Native's text finds it there through expo-font's
 * alias. SwiftUI's `font` modifier looks the name up in CoreText, which knows only the PostScript
 * name inside the file, and draws the system font for any other, without a word. So a modifier
 * that names a face as a `<text>` would is committed with the face's PostScript name, which the
 * build read from its file. Compose finds a face by the name it is registered under, so this is
 * for iOS alone.
 */
import type { PostScriptNames } from '@ng-native/fabric';
import type { UiModifier } from './expo-ui-components.ts';

/** The modifiers that take a family: `@expo/ui`'s `font`, and the segmented picker's copy of it. */
const TAKES_FAMILY = new Set(['font', 'ngNativeSegmentedFont']);

/**
 * Each list rewritten, with the families it was rewritten for, so a list committed again while
 * those still resolve as they did is the same list, which native is not sent twice.
 */
const rewritten = new WeakMap<
  readonly UiModifier[],
  { readonly modifiers: UiModifier[]; readonly families: readonly unknown[] }
>();

/** Names registered with expo-font by `Fonts`, which SwiftUI finds only by PostScript name. */
const registeredNames = new Set<string>();

/** Families already warned about, once each. */
const warned = new Set<string>();

/**
 * Families a modifier named that had no PostScript name, in development: a font still loading
 * when the view was committed is warned about once it registers, since nothing commits it again.
 */
const unfound = new Set<string>();

declare const ngDevMode: unknown;

/** Note the names `Fonts` registered faces under. See `fontModifierNames`. */
export function noteRegisteredNames(names: Iterable<string>): void {
  for (const name of names) {
    registeredNames.add(name);
    if (unfound.has(name)) warnUnfound(name);
  }
}

/** Rewrites the families of `props.modifiers` that name a face, as `ViewNameOptions.fontNames`. */
export function fontModifierNames(
  props: Record<string, unknown>,
  postScriptName: PostScriptNames,
): void {
  const modifiers = props['modifiers'];
  if (!Array.isArray(modifiers)) return;
  const list = modifiers as readonly UiModifier[];
  const families = list.map((modifier) => resolved(modifier, postScriptName));
  if (families.every((family, i) => family === list[i]?.['family'])) return;
  const known = rewritten.get(list);
  if (known?.families.every((family, i) => family === families[i])) {
    props['modifiers'] = known.modifiers;
    return;
  }
  const next = list.map((modifier, i) =>
    families[i] === modifier?.['family'] ? modifier : { ...modifier, family: families[i] },
  );
  rewritten.set(list, { modifiers: next, families });
  props['modifiers'] = next;
}

/** The family a modifier is committed with: the PostScript name of the face it names, or its own. */
function resolved(modifier: UiModifier, postScriptName: PostScriptNames): unknown {
  const family = modifier?.['family'];
  if (typeof family !== 'string' || !TAKES_FAMILY.has(modifier.$type)) return family;
  const name = postScriptName(family);
  if (name === undefined) warnUnfound(family);
  return name ?? family;
}

/**
 * In development, a family registered by name that no face read at build time has a PostScript
 * name for: a font loaded by hand with `Fonts.load`, or a face whose file could not be read. A
 * name nothing registered is left unsaid, since a font built into the system is found by a name
 * no app registers.
 */
function warnUnfound(family: string): void {
  if (typeof ngDevMode !== 'undefined' && !ngDevMode) return;
  unfound.add(family);
  if (!registeredNames.has(family) || warned.has(family)) return;
  warned.add(family);
  console.warn(
    `[angular-native] a SwiftUI 'font' modifier names '${family}', which expo-font registered ` +
      'but SwiftUI cannot find by that name: it draws the system font. Give the modifier the ' +
      "PostScript name inside the font's file instead, or declare the face with @font-face in a " +
      'stylesheet, whose file the build reads the name from.',
  );
}
