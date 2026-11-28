import type { TokenValue } from './css.ts';

/** A string as the CSSOM serialises one: in double quotes, with what would end it escaped. */
export function serializeString(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code === 0) out += '\uFFFD';
    else if ((code >= 0x1 && code <= 0x1f) || code === 0x7f) out += `\\${code.toString(16)} `;
    else out += char === '"' || char === '\\' ? `\\${char}` : char;
  }
  return `"${out}"`;
}

/** A token's colour as text: a platform colour as the `platform-color()` that names it. */
function colourText(colour: NonNullable<TokenValue['color']>): string {
  if (typeof colour === 'string') return colour;
  const names = colour.platformColor.map((name) =>
    /^[a-z_][\w-]*$/i.test(name) ? name : serializeString(name),
  );
  return `platform-color(${names.join(', ')})`;
}

/** A length as CSS writes it: points as px, and one in em or a viewport unit with what is added. */
function lengthText(length: NonNullable<TokenValue['length']>): string {
  if (typeof length === 'number') return `${length}px`;
  if (typeof length === 'string') return length;
  const { unit, factor, offset } = length.__defer;
  if (!offset) return `${factor}${unit}`;
  return `calc(${factor}${unit} ${offset < 0 ? '-' : '+'} ${Math.abs(offset)}px)`;
}

/**
 * A custom property as text, from the forms the engine keeps of it: what `getPropertyValue` reads
 * for a `--name`, and what `Engine.token` answers. Empty for one with no form a value is read in.
 */
export function tokenText(token: TokenValue | undefined): string {
  if (!token) return '';
  if (token.keyword !== undefined) return token.keyword;
  if (token.number !== undefined) return String(token.number);
  if (token.length !== undefined) return lengthText(token.length);
  if (token.color !== undefined) return colourText(token.color);
  if (token.angle !== undefined) return `${token.angle}deg`;
  if (token.time !== undefined) return `${token.time}ms`;
  if (token.lengths)
    return token.lengths.map((each) => (typeof each === 'number' ? `${each}px` : each)).join(' ');
  return token.weight ?? token.family ?? '';
}
