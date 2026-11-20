/**
 * The archives Linux packaging writes, in JavaScript so a Mac makes the same bytes as Linux with no
 * tools: a gzipped tar (the `app` format's `.tar.gz`, a `.deb`'s members) and the `ar` archive a
 * `.deb` is. Every entry is owned by root, as a package's files must be when they install, with no
 * extended attributes or macOS metadata, and a fixed time, so the same input makes the same file.
 */
import { gzipSync } from 'node:zlib';

/**
 * @typedef {{ path: string, mode: number, data?: Uint8Array, link?: string }} ArchiveEntry
 *   `path` is relative, with `/` between parts, and a folder's ends in `/`; a file has `data`, and a
 *   symbolic link the path it points to in `link`
 */

const BLOCK = 512;

/**
 * Writes `value` as a NUL-terminated octal field of `length` bytes at `offset`.
 *
 * @param {Buffer} header
 * @param {number} offset
 * @param {number} length
 * @param {number} value
 */
function octal(header, offset, length, value) {
  header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii');
}

/**
 * A path's ustar `name` and `prefix`, splitting a long one at a `/`. Throws for a path no split fits.
 *
 * @param {string} name
 */
function ustarName(name) {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: '' };
  for (let at = name.indexOf('/'); at !== -1; at = name.indexOf('/', at + 1)) {
    const prefix = name.slice(0, at);
    const rest = name.slice(at + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) {
      return { name: rest, prefix };
    }
  }
  throw new Error(`${name} is too long for a tar archive.`);
}

/**
 * An entry's type flag and contents: a folder (`5`) and a link (`2`) have none.
 *
 * @param {ArchiveEntry} entry
 */
function contentsOf(entry) {
  if (entry.path.endsWith('/')) return { type: '5', data: Buffer.alloc(0) };
  if (entry.link !== undefined) return { type: '2', data: Buffer.alloc(0) };
  return { type: '0', data: Buffer.from(entry.data ?? new Uint8Array()) };
}

/**
 * An entry's ustar header, owned by root:root.
 *
 * @param {ArchiveEntry} entry
 * @param {{ type: string, size: number, time: number }} fields
 */
function tarHeader(entry, { type, size, time }) {
  const header = Buffer.alloc(BLOCK);
  const { name, prefix } = ustarName(entry.path);
  header.write(name, 0, 100, 'utf8');
  octal(header, 100, 8, entry.mode & 0o7777);
  octal(header, 108, 8, 0);
  octal(header, 116, 8, 0);
  octal(header, 124, 12, size);
  octal(header, 136, 12, time);
  // The checksum is summed with its own field as spaces.
  header.fill(' ', 148, 156);
  header.write(type, 156, 1, 'ascii');
  const link = entry.link ?? '';
  if (Buffer.byteLength(link) > 100) throw new Error(`${link} is too long for a tar link.`);
  header.write(link, 157, 100, 'utf8');
  header.write('ustar\0' + '00', 257, 8, 'ascii');
  header.write('root', 265, 32, 'ascii');
  header.write('root', 297, 32, 'ascii');
  header.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

/**
 * A ustar archive of `entries`, in their order, each owned by root:root.
 *
 * @param {readonly ArchiveEntry[]} entries
 * @param {{ time?: number }} [options] the entries' modification time, in seconds
 */
export function tar(entries, { time = 0 } = {}) {
  /** @type {Buffer[]} */
  const parts = [];
  for (const entry of entries) {
    const { type, data } = contentsOf(entry);
    parts.push(tarHeader(entry, { type, size: data.length, time }), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad > 0) parts.push(Buffer.alloc(pad));
  }
  // Two empty blocks end the archive.
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

/**
 * `tar(entries)`, gzipped.
 *
 * @param {readonly ArchiveEntry[]} entries
 */
export function tarGz(entries) {
  return gzipSync(tar(entries), { level: 9 });
}

/**
 * The folders each entry is in, as entries of their own, before it: a package manager makes a
 * folder only when the archive names it.
 *
 * @param {readonly ArchiveEntry[]} entries
 * @returns {ArchiveEntry[]}
 */
export function withFolders(entries) {
  const seen = new Set(entries.filter((entry) => entry.path.endsWith('/')).map((e) => e.path));
  /** @type {ArchiveEntry[]} */
  const out = [];
  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean);
    for (let depth = 1; depth < parts.length; depth++) {
      const folder = `${parts.slice(0, depth).join('/')}/`;
      if (!seen.has(folder)) {
        seen.add(folder);
        out.push({ path: folder, mode: 0o755 });
      }
    }
    out.push(entry);
  }
  return out;
}

/**
 * An `ar` archive of `members`, as a `.deb` is: the common format, with names of 16 bytes at most.
 *
 * @param {readonly { name: string, data: Uint8Array }[]} members
 */
export function ar(members) {
  /** @type {Buffer[]} */
  const parts = [Buffer.from('!<arch>\n', 'ascii')];
  for (const { name, data } of members) {
    if (name.length > 16) throw new Error(`${name} is too long for an ar member's name.`);
    const field = (/** @type {string} */ value, /** @type {number} */ width) =>
      value.padEnd(width, ' ');
    const header =
      field(name, 16) +
      field('0', 12) +
      field('0', 6) +
      field('0', 6) +
      field('100644', 8) +
      field(String(data.length), 10) +
      '`\n';
    parts.push(Buffer.from(header, 'ascii'), Buffer.from(data));
    if (data.length % 2 === 1) parts.push(Buffer.from('\n', 'ascii'));
  }
  return Buffer.concat(parts);
}
