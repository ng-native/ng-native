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
 * declares them. `Inter`, `Inter-600`, `Inter-italic`, `Inter-600-italic`.
 */
export function faceName(face: Pick<FontFace, 'family' | 'weight' | 'style'>): string {
  let name = face.family;
  if (face.weight !== undefined) name += `-${face.weight}`;
  if (face.style) name += `-${face.style}`;
  return name;
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

  const weightOfFace = (face: FontFace) => face.weight ?? 400;
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

  add(faces: readonly FontFace[]): void {
    for (const face of faces) {
      const known = this.byFamily.get(familyKey(face.family));
      if (!known) this.byFamily.set(familyKey(face.family), [face]);
      else if (!known.some((one) => faceName(one) === faceName(face))) known.push(face);
    }
  }

  /**
   * Point a resolved style's family at the face its weight and style ask for. A family nothing
   * declared, or one whose match is the face registered under the family itself, is left alone.
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
    if (name === family) return;

    style['fontFamily'] = name;
    if (!DROP_MATCHED_WEIGHT_AND_STYLE) return;
    if (face.weight !== undefined) delete style['fontWeight'];
    if (face.style) delete style['fontStyle'];
  }
}
