/**
 * Scales a PNG app icon to the hicolor theme's sizes, in JavaScript, so a Linux package's icons come
 * out the same from a Mac as from Linux with no image tool. It reads the PNGs an icon is saved as
 * (1 to 16 bits a sample; grey, RGB, palette, with alpha or not; not interlaced, with a `tRNS` colour
 * key or palette alpha) and writes 8-bit RGBA, averaging each output pixel's area with its colour
 * weighted by alpha.
 */
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Samples a pixel has, by PNG colour type. */
const CHANNELS = /** @type {Record<number, number>} */ ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 });

/**
 * @typedef {{ width: number, height: number, rgba: Uint8Array }} Image
 */

/**
 * @param {number} a
 * @param {number} b
 * @param {number} c
 */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * @typedef {{ width: number, height: number, depth: number, type: number, palette: Buffer | null, transparency: Buffer | null, data: Buffer[] }} PngChunks
 */

/**
 * The chunks of a PNG file this reads: the header's fields, the palette and its alpha, and the
 * image data.
 *
 * @param {Buffer} file
 * @returns {PngChunks}
 */
function readChunks(file) {
  /** @type {PngChunks} */
  const png = {
    width: 0,
    height: 0,
    depth: 0,
    type: 0,
    palette: null,
    transparency: null,
    data: [],
  };
  for (let at = 8; at + 8 <= file.length;) {
    const length = file.readUInt32BE(at);
    const kind = file.toString('ascii', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (kind === 'IEND') break;
    if (kind === 'IHDR') readHeader(png, body);
    else if (kind === 'PLTE') png.palette = body;
    else if (kind === 'tRNS') png.transparency = body;
    else if (kind === 'IDAT') png.data.push(body);
  }
  return png;
}

/**
 * @param {PngChunks} png
 * @param {Buffer} body
 */
function readHeader(png, body) {
  png.width = body.readUInt32BE(0);
  png.height = body.readUInt32BE(4);
  png.depth = body[8] ?? 0;
  png.type = body[9] ?? 0;
  if (png.width > MAX_SIDE || png.height > MAX_SIDE) {
    throw new Error(
      `it is ${png.width} by ${png.height}; save it at ${MAX_SIDE} pixels a side or fewer`,
    );
  }
  if (body[12] !== 0) throw new Error('it is interlaced; save it without interlacing');
}

/**
 * A byte with its row's filter undone, from the bytes to its left, above, and above-left.
 *
 * @param {number} filter
 * @param {number} value
 * @param {number} left
 * @param {number} up
 * @param {number} corner
 */
function unfilter(filter, value, left, up, corner) {
  const predictors = [0, left, up, (left + up) >> 1, paeth(left, up, corner)];
  const predicted = predictors[filter];
  if (predicted === undefined)
    throw new Error(`a row has filter ${filter}, which PNG does not define`);
  return (value + predicted) & 0xff;
}

/**
 * The image's rows with each row's filter undone, `stride` bytes a row.
 *
 * @param {Buffer} raw
 * @param {{ height: number, stride: number, bytesPerPixel: number }} layout
 */
function unfilterRows(raw, { height, stride, bytesPerPixel }) {
  if (raw.length < (stride + 1) * height) throw new Error('its image data is cut short');
  const rows = Buffer.alloc(stride * height);
  const at = (/** @type {number} */ index) => (index >= 0 ? (rows[index] ?? 0) : 0);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= bytesPerPixel ? at(out + x - bytesPerPixel) : 0;
      const corner = x >= bytesPerPixel ? at(out + x - stride - bytesPerPixel) : 0;
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      rows[out + x] = unfilter(filter, value, left, at(out + x - stride), corner);
    }
  }
  return rows;
}

/**
 * One pixel as RGBA, from its samples as stored (`raw`, at the image's own depth) and, for a palette
 * image, the palette and its alpha. A grey or RGB image's one transparent colour (its `tRNS` key) is
 * compared with the stored samples, before they are reduced to 8 bits.
 *
 * @param {PngChunks} png
 * @param {(channel: number) => number} raw
 * @returns {[number, number, number, number]}
 */
function pixelColour({ type, depth, palette, transparency }, raw) {
  const to8 = (/** @type {number} */ channel) => {
    const value = raw(channel);
    if (depth === 8) return value;
    return depth === 16 ? value >> 8 : Math.round((value * 255) / ((1 << depth) - 1));
  };
  /** @param {number} channels */
  const keyed = (channels) =>
    transparency !== null &&
    transparency.length >= channels * 2 &&
    Array.from({ length: channels }, (_, channel) => channel).every(
      (channel) => raw(channel) === transparency.readUInt16BE(channel * 2),
    );
  if (type === 0) return [to8(0), to8(0), to8(0), keyed(1) ? 0 : 255];
  if (type === 4) return [to8(0), to8(0), to8(0), to8(1)];
  if (type === 2) return [to8(0), to8(1), to8(2), keyed(3) ? 0 : 255];
  if (type === 6) return [to8(0), to8(1), to8(2), to8(3)];
  const index = raw(0);
  const colours = /** @type {Buffer} */ (palette);
  const alpha = transparency?.[index] ?? 255;
  return [colours[index * 3] ?? 0, colours[index * 3 + 1] ?? 0, colours[index * 3 + 2] ?? 0, alpha];
}

/** The longest side this decodes: an icon is 1024, and a header can claim far more than it holds. */
const MAX_SIDE = 4096;

/**
 * The image data inflated, which must be exactly `size` bytes: inflating stops there, so a
 * stream that expands without end cannot use the memory.
 *
 * @param {Buffer[]} chunks
 * @param {number} size
 */
function inflated(chunks, size) {
  let data;
  try {
    data = inflateSync(Buffer.concat(chunks), { maxOutputLength: size });
  } catch (error) {
    if (error instanceof RangeError) throw new Error('its image data is more than its header says');
    throw error;
  }
  if (data.length !== size) throw new Error('its image data is not the size its header says');
  return data;
}

/** The bit depths each colour type may have. */
const DEPTHS = /** @type {Record<number, number[]>} */ ({
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
});

/**
 * The image in a PNG file, as 8-bit RGBA. Throws, naming what it does not read, for anything else.
 *
 * @param {Uint8Array} bytes
 * @returns {Image}
 */
export function decodePng(bytes) {
  const file = Buffer.from(bytes);
  if (file.length < 8 || !file.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('it is not a PNG file');
  }
  const png = readChunks(file);
  const { width, height, depth, type } = png;
  const channels = CHANNELS[type];
  if (!channels || width === 0 || height === 0) throw new Error('its header is not one this reads');
  if (!DEPTHS[type]?.includes(depth)) {
    throw new Error(`it has ${depth} bits a channel, which PNG does not allow for its colour type`);
  }
  if (type === 3 && !png.palette) throw new Error('it has a palette type and no palette');
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const rows = unfilterRows(inflated(png.data, (stride + 1) * height), {
    height,
    stride,
    // A pixel narrower than a byte filters against the byte before it.
    bytesPerPixel: Math.max(1, bitsPerPixel / 8),
  });
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const row = Math.floor(pixel / width) * stride;
    const start = (pixel % width) * bitsPerPixel;
    const raw = (/** @type {number} */ channel) => {
      const bit = start + channel * depth;
      const byte = row + (bit >> 3);
      if (depth === 16) return ((rows[byte] ?? 0) << 8) | (rows[byte + 1] ?? 0);
      if (depth === 8) return rows[byte] ?? 0;
      return ((rows[byte] ?? 0) >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    };
    rgba.set(pixelColour(png, raw), pixel * 4);
  }
  return { width, height, rgba };
}

/**
 * `image` scaled to `size` by `size`, each output pixel the average of the source area it covers,
 * with colour weighted by alpha so transparent pixels do not darken an edge.
 *
 * @param {Image} image
 * @param {number} size
 * @returns {Image}
 */
export function scaleImage({ width, height, rgba }, size) {
  const out = new Uint8Array(size * size * 4);
  const sx = width / size;
  const sy = height / size;
  for (let y = 0; y < size; y++) {
    const y0 = y * sy;
    const y1 = y0 + sy;
    for (let x = 0; x < size; x++) {
      const x0 = x * sx;
      const x1 = x0 + sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let py = Math.floor(y0); py < Math.ceil(y1) && py < height; py++) {
        const wy = Math.min(py + 1, y1) - Math.max(py, y0);
        for (let px = Math.floor(x0); px < Math.ceil(x1) && px < width; px++) {
          const w = wy * (Math.min(px + 1, x1) - Math.max(px, x0));
          const i = (py * width + px) * 4;
          const alpha = (rgba[i + 3] ?? 0) * w;
          r += (rgba[i] ?? 0) * alpha;
          g += (rgba[i + 1] ?? 0) * alpha;
          b += (rgba[i + 2] ?? 0) * alpha;
          a += alpha;
          area += w;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / area);
    }
  }
  return { width: size, height: size, rgba: out };
}

/**
 * @param {string} kind
 * @param {Uint8Array} body
 */
function chunk(kind, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const named = Buffer.concat([Buffer.from(kind, 'ascii'), body]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(named));
  return Buffer.concat([length, named, check]);
}

/**
 * An 8-bit RGBA PNG of `image`.
 *
 * @param {Image} image
 */
export function encodePng({ width, height, rgba }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
