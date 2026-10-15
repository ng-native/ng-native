/**
 * Font matching, which native does not do.
 *
 * A device finds a family by name and nothing else, so each `@font-face` is registered under a
 * name of its own (`faceName`), and a text asking for a declared family with a weight or a style
 * is pointed at the face CSS would pick for it. That happens on the resolved style, after the
 * cascade, because a family and a weight often come from different rules or from an ancestor.
 */
import type { StyleSheet } from './css.ts';

type FontFace = NonNullable<StyleSheet['fonts']>[number];

/**
 * When a face was picked, whether to drop the `fontWeight` and `fontStyle` it was picked for from
 * what is committed. The face already draws them, and kept, the platform may embolden or slant it
 * again on top.
 */
export const DROP_MATCHED_WEIGHT_AND_STYLE = true;

/**
 * The name a face is registered under: the family, then its weight and its style where it
 * declares them. `Inter`, `Inter-600`, `Inter-italic`, `Inter-600-italic`. A variable font's
 * range is both its ends, `Inter-100to900`, so two files that split a family by range differ.
 */
export function faceName(
  face: Pick<FontFace, 'family' | 'weight' | 'weightRange' | 'style'>,
): string {
  let name = face.family;
  if (face.weight !== undefined) name += `-${face.weight}`;
  else if (face.weightRange) name += `-${face.weightRange[0]}to${face.weightRange[1]}`;
  if (face.style) name += `-${face.style}`;
  return name;
}

/**
 * Every name the faces are registered under, and the face each names, in the order they are
 * registered. A face is registered under `faceName`, the last face of that name winning, and the
 * first face of a family under the family as well. A face with both a weight and a style also
 * answers to each alone, where no face declared exactly that.
 */
export function registeredFaces<Face extends FontFace>(faces: readonly Face[]): Map<string, Face> {
  const names = new Map<string, Face>();
  for (const face of faces) {
    if (!names.has(face.family)) names.set(face.family, face);
    names.set(faceName(face), face);
  }
  for (const face of faces) {
    if (face.weight === undefined || !face.style) continue;
    for (const name of [`${face.family}-${face.weight}`, `${face.family}-${face.style}`]) {
      if (!names.has(name)) names.set(name, face);
    }
  }
  return names;
}

/** CSS's fallback order for a style: the closest slant first, upright last. */
const STYLE_ORDER: Readonly<Record<string, readonly string[]>> = {
  italic: ['italic', 'oblique', 'normal'],
  oblique: ['oblique', 'italic', 'normal'],
  normal: ['normal', 'oblique', 'italic'],
};

/** A `fontWeight` as a number: `normal` and unset are 400, `bold` 700. NaN for anything else. */
function weightOf(value: unknown): number {
  if (value === undefined || value === 'normal') return 400;
  if (value === 'bold') return 700;
  return Number(value);
}

/**
 * The face CSS's matching picks among one family's, for a wanted weight and style.
 *
 * Style first, then weight, as in CSS Fonts 4 section 5.2. For a weight from 400 to 500, the
 * weights up to 500 are tried first, then lighter ones, then heavier; under 400, lighter then
 * heavier; over 500, heavier then lighter. Each direction nearest first.
 */
export function matchFace(
  faces: readonly FontFace[],
  weight: number,
  style: string,
): FontFace | undefined {
  const slant = (face: FontFace) => face.style ?? 'normal';
  const order = STYLE_ORDER[style] ?? STYLE_ORDER['normal']!;
  const wantedStyle = order.find((one) => faces.some((face) => slant(face) === one));
  const candidates = faces.filter((face) => slant(face) === wantedStyle);

  // A face that covers a range has every weight in it: the nearest it has to the one wanted.
  const weightOfFace = (face: FontFace) =>
    face.weightRange
      ? Math.min(Math.max(weight, face.weightRange[0]), face.weightRange[1])
      : (face.weight ?? 400);
  const heavier = (from: number, to: number) =>
    candidates
      .filter((face) => weightOfFace(face) >= from && weightOfFace(face) <= to)
      .sort((a, b) => weightOfFace(a) - weightOfFace(b))[0];
  const lighter = (upTo: number) =>
    candidates
      .filter((face) => weightOfFace(face) <= upTo)
      .sort((a, b) => weightOfFace(b) - weightOfFace(a))[0];

  if (weight >= 400 && weight <= 500) {
    return heavier(weight, 500) ?? lighter(weight) ?? heavier(500, Infinity);
  }
  if (weight < 400) return lighter(weight) ?? heavier(weight, Infinity);
  return heavier(weight, Infinity) ?? lighter(weight);
}

/** A family as CSS compares it: without regard to case. */
const familyKey = (family: string) => family.toLowerCase();

/** Every face the engine has seen a sheet declare, by family. */
export class FontFaces {
  private readonly byFamily = new Map<string, FontFace[]>();
  /** Every face, in the order taken in. */
  private readonly faces: FontFace[] = [];
  /** What `postScriptName` reads, made again on the first read after the faces change. */
  private names: Map<string, FontFace> | null = null;

  /** Forget every face, before they are taken in again from the sheets still registered. */
  clear(): void {
    this.byFamily.clear();
    this.faces.length = 0;
    this.names = null;
  }

  /**
   * The PostScript name of the face a name is registered under, as `registeredFaces` names them,
   * where the build could read it from the face's file.
   */
  postScriptName(name: string): string | undefined {
    this.names ??= registeredFaces(this.faces);
    return this.names.get(name)?.postScriptName;
  }

  /** Take faces in; whether any was new, which changes what text already matched may match. */
  add(faces: readonly FontFace[]): boolean {
    let added = false;
    for (const face of faces) {
      const known = this.byFamily.get(familyKey(face.family));
      if (known?.some((one) => faceName(one) === faceName(face))) continue;
      if (known) known.push(face);
      else this.byFamily.set(familyKey(face.family), [face]);
      this.faces.push(face);
      added = true;
    }
    if (added) this.names = null;
    return added;
  }

  /**
   * Point a resolved style's family at the face its weight and style ask for. A family nothing
   * declared is left alone, and so is the family of one whose match is the face registered under
   * the family itself.
   */
  apply(style: Record<string, unknown>): void {
    if (this.byFamily.size === 0) return;
    const family = style['fontFamily'];
    if (typeof family !== 'string') return;
    const faces = this.byFamily.get(familyKey(family));
    if (!faces) return;

    const weight = weightOf(style['fontWeight']);
    if (Number.isNaN(weight)) return;
    const face = matchFace(faces, weight, String(style['fontStyle'] ?? 'normal'));
    if (!face) return;
    const name = faceName(face);
    if (name !== family) style['fontFamily'] = name;

    if (!DROP_MATCHED_WEIGHT_AND_STYLE) return;
    // The style goes whichever face matched: a slanted face draws its slant, and beside an
    // upright one Android draws its system font slanted in place of the face, which iOS draws
    // upright anyway.
    delete style['fontStyle'];
    // A face of one weight draws it. One that covers a range is told which, so the weight stays.
    if (face.weight !== undefined) delete style['fontWeight'];
  }
}
