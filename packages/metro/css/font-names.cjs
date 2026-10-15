// @ts-check
/**
 * The PostScript name each `@font-face` file gives itself.
 *
 * A face is registered with expo-font under the name the app's CSS gives it (`Brand-700`), and
 * React Native's text finds it there through expo-font's alias. SwiftUI's `font` modifier looks a
 * name up in CoreText instead, which knows a font only by the name inside its file. So the build
 * reads that name, and the engine commits a `font` modifier on a SwiftUI view with it.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { inflateSync } = require('node:zlib');

/** The PostScript name's id in a font's `name` table. */
const POSTSCRIPT_NAME = 6;

/** The platforms a name is read for: Unicode, Mac and Windows. ISO's and custom ones are passed over. */
const READ = new Set([0, 1, 3]);

/**
 * The PostScript name in a TrueType, OpenType or WOFF file, or in the first font of a collection,
 * which is the one a device loads. Null for a file this cannot read, such as a WOFF2, whose tables
 * are compressed as one stream with transforms of their own.
 *
 * @param {Buffer} data
 * @returns {string | null}
 */
function postScriptNameIn(data) {
  const tag = data.toString('latin1', 0, 4);
  if (tag === 'wOFF') return nameIn(woffTable(data, 'name'));
  if (tag === 'ttcf') return nameIn(sfntTable(data, data.readUInt32BE(12), 'name'));
  if (tag === 'OTTO' || tag === 'true' || data.readUInt32BE(0) === 0x00010000) {
    return nameIn(sfntTable(data, 0, 'name'));
  }
  return null;
}

/**
 * A table of the sfnt whose directory is at `at`, or null.
 *
 * @param {Buffer} data
 * @param {number} at
 * @param {string} wanted
 */
function sfntTable(data, at, wanted) {
  const count = data.readUInt16BE(at + 4);
  for (let i = 0; i < count; i++) {
    const entry = at + 12 + 16 * i;
    if (data.toString('latin1', entry, entry + 4) !== wanted) continue;
    const offset = data.readUInt32BE(entry + 8);
    return data.subarray(offset, offset + data.readUInt32BE(entry + 12));
  }
  return null;
}

/**
 * A table of a WOFF, inflated where it was stored compressed, or null.
 *
 * @param {Buffer} data
 * @param {string} wanted
 */
function woffTable(data, wanted) {
  const count = data.readUInt16BE(12);
  for (let i = 0; i < count; i++) {
    const entry = 44 + 20 * i;
    if (data.toString('latin1', entry, entry + 4) !== wanted) continue;
    const offset = data.readUInt32BE(entry + 4);
    const stored = data.subarray(offset, offset + data.readUInt32BE(entry + 8));
    return stored.length < data.readUInt32BE(entry + 12) ? inflateSync(stored) : stored;
  }
  return null;
}

/**
 * The PostScript name a `name` table holds: Windows's record first, then Mac's, then Unicode's,
 * as CoreText prefers them. Windows's and Unicode's are UTF-16, Mac's Roman, which a PostScript
 * name, being ASCII, reads the same as Latin-1.
 *
 * @param {Buffer | null} table
 * @returns {string | null}
 */
function nameIn(table) {
  if (!table) return null;
  const count = table.readUInt16BE(2);
  const strings = table.readUInt16BE(4);
  /** @type {Map<number, string>} */
  const byPlatform = new Map();
  for (let i = 0; i < count; i++) {
    const record = 6 + 12 * i;
    const platform = table.readUInt16BE(record);
    if (table.readUInt16BE(record + 6) !== POSTSCRIPT_NAME || !READ.has(platform)) continue;
    const start = strings + table.readUInt16BE(record + 10);
    const bytes = table.subarray(start, start + table.readUInt16BE(record + 8));
    byPlatform.set(platform, platform === 1 ? bytes.toString('latin1') : utf16(bytes));
  }
  return byPlatform.get(3) || byPlatform.get(1) || byPlatform.get(0) || null;
}

/** @param {Buffer} bytes */
const utf16 = (bytes) => Buffer.from(bytes).swap16().toString('utf16le');

/**
 * The file a face's source names, from the directory the source is resolved from: a relative path,
 * or a file in a package. Null when there is none, which the bundler reports on its own.
 *
 * @param {string} asset
 * @param {string} from
 */
function fileOf(asset, from) {
  if (/^\.\.?\//.test(asset) || path.isAbsolute(asset)) return path.resolve(from, asset);
  try {
    return require.resolve(asset, { paths: [from] });
  } catch {
    return null;
  }
}

/**
 * Give each face of `sheet` the PostScript name its file says, where it can be read.
 *
 * `from` is the directory a face's source is resolved from, and `read` is told each file read, for
 * the transform cache to miss once it changes. A file whose name cannot be read is reported to
 * `warn`, and its face keeps the name it was registered under, which SwiftUI cannot find.
 *
 * @param {{ fonts?: { family: string, source: unknown, postScriptName?: string }[] }} sheet
 * @param {string} from
 * @param {(file: string) => void} read
 * @param {(message: string) => void} warn
 */
function nameFaces(sheet, from, read, warn) {
  for (const face of sheet.fonts ?? []) {
    const asset = /** @type {{ asset: string }} */ (face.source).asset;
    const file = fileOf(asset, from);
    /** @type {Buffer} */
    let data;
    try {
      data = readFileSync(/** @type {string} */ (file));
    } catch {
      continue;
    }
    read(/** @type {string} */ (file));
    let name = null;
    try {
      name = postScriptNameIn(data);
    } catch {
      // A truncated or malformed file: the same as one in a format this does not read.
    }
    if (name) face.postScriptName = name;
    else {
      warn(
        `@font-face '${face.family}': could not read the PostScript name in '${asset}', so a ` +
          "SwiftUI 'font' modifier naming this face draws the system font. Use a .ttf or .otf, " +
          'or give the modifier the PostScript name itself.',
      );
    }
  }
}

module.exports = { nameFaces, postScriptNameIn };
