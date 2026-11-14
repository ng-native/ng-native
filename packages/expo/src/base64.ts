const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bytes as base64, written here: Hermes has had no `btoa` in every version, and it takes text. */
export function base64Of(bytes: Uint8Array): string {
  let out = '';
  for (let at = 0; at < bytes.length; at += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[at], bytes[at + 1], bytes[at + 2]];
    const chunk = (a << 16) | (b << 8) | c;
    out += BASE64[(chunk >> 18) & 63]! + BASE64[(chunk >> 12) & 63]!;
    out += at + 1 < bytes.length ? BASE64[(chunk >> 6) & 63]! : '=';
    out += at + 2 < bytes.length ? BASE64[chunk & 63]! : '=';
  }
  return out;
}

/** The bytes of a base64 string, with or without its padding. */
export function bytesOf(base64: string): Uint8Array {
  const text = base64.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let at = 0;
  for (let i = 0; i < text.length; i += 4) {
    const chunk = [0, 1, 2, 3].reduce(
      (n, k) => (n << 6) | Math.max(BASE64.indexOf(text[i + k] ?? 'A'), 0),
      0,
    );
    for (let k = 0; k < 3 && at < bytes.length; k++) bytes[at++] = (chunk >> (16 - 8 * k)) & 255;
  }
  return bytes;
}
