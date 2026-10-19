/**
 * Pixels as a PNG, for a canvas that shows pixels a script put on it and for `toDataURL`. There
 * is no compressor in React Native's JavaScript, and none is needed: a PNG's data may be stored
 * in deflate blocks that are not compressed, which every decoder reads. The file is a little
 * larger than the pixels, four bytes each and one a row.
 */

/** The CRC of every byte, which a PNG chunk ends with. Made the first time one is written. */
let crcTable: Uint32Array | undefined;

function crcOf(bytes: Uint8Array, from: number, to: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let at = from; at < to; at++) crc = crcTable[(crc ^ bytes[at]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The largest a stored deflate block holds. */
const BLOCK = 0xffff;

/** The rows of pixels as a PNG has them: each after a byte saying it is not filtered. */
function rowsOf(width: number, height: number, rgba: ArrayLike<number>): Uint8Array {
  const row = width * 4;
  const raw = new Uint8Array(height * (row + 1));
  const source = rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray ? rgba : null;
  for (let y = 0; y < height; y++) {
    const at = y * (row + 1) + 1;
    if (source) raw.set(source.subarray(y * row, (y + 1) * row), at);
    else for (let x = 0; x < row; x++) raw[at + x] = rgba[y * row + x]!;
  }
  return raw;
}

/** Bytes as a zlib stream of stored blocks, with the checksum it ends with. */
function stored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / BLOCK));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let to = 2;
  for (let block = 0; block < blocks; block++) {
    const part = raw.subarray(block * BLOCK, (block + 1) * BLOCK);
    out[to] = block === blocks - 1 ? 1 : 0;
    out[to + 1] = part.length & 0xff;
    out[to + 2] = part.length >>> 8;
    out[to + 3] = ~part.length & 0xff;
    out[to + 4] = (~part.length >>> 8) & 0xff;
    out.set(part, to + 5);
    to += 5 + part.length;
  }
  let [a, b] = [1, 0];
  for (let at = 0; at < raw.length; at++) {
    a = (a + raw[at]!) % 65521;
    b = (b + a) % 65521;
  }
  new DataView(out.buffer).setUint32(to, ((b << 16) | a) >>> 0);
  return out;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** A PNG of pixels four bytes each, red, green, blue and alpha, not premultiplied. */
export function pngOf(width: number, height: number, rgba: ArrayLike<number>): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  // Eight bits a channel, colour with alpha, deflated, filtered by rows, not interlaced.
  header.set([8, 6, 0, 0, 0], 8);
  const chunks: [string, Uint8Array][] = [
    ['IHDR', header],
    ['IDAT', stored(rowsOf(width, height, rgba))],
    ['IEND', new Uint8Array(0)],
  ];
  const size = SIGNATURE.length + chunks.reduce((sum, [, data]) => sum + 12 + data.length, 0);
  const out = new Uint8Array(size);
  const into = new DataView(out.buffer);
  out.set(SIGNATURE);
  let at = SIGNATURE.length;
  for (const [type, data] of chunks) {
    into.setUint32(at, data.length);
    for (let letter = 0; letter < 4; letter++) out[at + 4 + letter] = type.charCodeAt(letter);
    out.set(data, at + 8);
    into.setUint32(at + 8 + data.length, crcOf(out, at + 4, at + 8 + data.length));
    at += 12 + data.length;
  }
  return out;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bytes as base64, written here: Hermes has had no `btoa` in every version, and it takes text. */
export function base64Of(bytes: Uint8Array): string {
  const parts: string[] = [];
  let line = '';
  for (let at = 0; at < bytes.length; at += 3) {
    const [a, b, c] = [bytes[at]!, bytes[at + 1], bytes[at + 2]];
    const word = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    line +=
      LETTERS[word >>> 18]! +
      LETTERS[(word >>> 12) & 63]! +
      (b === undefined ? '=' : LETTERS[(word >>> 6) & 63]!) +
      (c === undefined ? '=' : LETTERS[word & 63]!);
    // Joined in parts: one string added to a letter at a time grows slower the longer it is.
    if (line.length >= 4096) [parts[parts.length], line] = [line, ''];
  }
  parts.push(line);
  return parts.join('');
}

/** Pixels as a `data:` URL of a PNG: what an image view shows and `toDataURL` answers. */
export const pngUrlOf = (width: number, height: number, rgba: ArrayLike<number>): string =>
  `data:image/png;base64,${base64Of(pngOf(width, height, rgba))}`;
