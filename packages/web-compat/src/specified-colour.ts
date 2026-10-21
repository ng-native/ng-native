import { alphaText, canvasColour } from './canvas-colour.ts';
import { isColour } from './css-colour-names.ts';
import type { Part } from './css-grammar.ts';

/**
 * A colour as a declaration block writes it back (https://drafts.csswg.org/cssom/#serializing-css-values):
 * a name in lower case, and a hex, `rgb()` or `hsl()` colour as the `rgb()` or `rgba()` it is.
 * Answers nothing for one written wrongly, `rgb(0, 100%, 100%)`, which is no colour, and the
 * colour as it is for any other kind, `oklch()` among them.
 *
 * ponytail: `hwb()` and the colours of a colour space are kept as written.
 */
export function specifiedColour(part: Part, written: string): string | undefined {
  const { token } = part;
  if (token.type === 'ident') return token.value.toLowerCase();
  const named = token.type === 'function' ? token.value.toLowerCase() : '';
  const worked =
    token.type === 'hash' || (/^(rgba?|hsla?)$/.test(named) && !/^\w+\(\s*from\s/i.test(written));
  // An `oklab()` or `oklch()` lightness as a percentage is the share of one it is.
  if (/^ok(lab|lch)$/.test(named))
    return written.replace(
      /^(\w+\(\s*)([\d.]+)%/,
      (_, head: string, n: string) => `${head}${Number(n) / 100}`,
    );
  if (!worked) return written;
  const colour = canvasColour(written);
  if (!colour) return undefined;
  const [r, g, b, a] = colour;
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alphaText(a)})`;
}

/** Whether a value is one colour, which is written back as `specifiedColour` writes one. */
export const isOneColour = (parts: readonly Part[]): boolean =>
  parts.length === 1 && isColour(parts[0]!);
