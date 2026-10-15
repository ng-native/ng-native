/**
 * Font files small enough to write in a test: an sfnt holding a `name` table and little else, which
 * is all a reader of the PostScript name looks at.
 */
import { deflateSync } from 'node:zlib';

export interface NameRecord {
  readonly platform: number;
  readonly id: number;
  readonly value: string;
}

/** A `name` table holding the records given, Unicode and Windows ones in UTF-16, Mac ones in one byte. */
export function nameTable(records: readonly NameRecord[]): Buffer {
  const strings = records.map(({ platform, value }) =>
    platform === 1 ? Buffer.from(value, 'latin1') : Buffer.from(value, 'utf16le').swap16(),
  );
  const head = Buffer.alloc(6 + 12 * records.length);
  head.writeUInt16BE(0, 0);
  head.writeUInt16BE(records.length, 2);
  head.writeUInt16BE(head.length, 4);
  let offset = 0;
  records.forEach((record, i) => {
    const at = 6 + 12 * i;
    head.writeUInt16BE(record.platform, at);
    head.writeUInt16BE(record.platform === 3 ? 1 : 0, at + 2);
    head.writeUInt16BE(record.platform === 3 ? 0x409 : 0, at + 4);
    head.writeUInt16BE(record.id, at + 6);
    head.writeUInt16BE(strings[i]!.length, at + 8);
    head.writeUInt16BE(offset, at + 10);
    offset += strings[i]!.length;
  });
  return Buffer.concat([head, ...strings]);
}

/** An sfnt with a `head` table of zeros and the `name` table given, its tables from `base` on. */
export function sfnt(name: Buffer, version = 0x00010000, base = 0): Buffer {
  const tables: [string, Buffer][] = [
    ['head', Buffer.alloc(54)],
    ['name', name],
  ];
  const directory = Buffer.alloc(12 + 16 * tables.length);
  directory.writeUInt32BE(version, 0);
  directory.writeUInt16BE(tables.length, 4);
  let offset = base + directory.length;
  tables.forEach(([tag, data], i) => {
    const at = 12 + 16 * i;
    directory.write(tag, at, 'latin1');
    directory.writeUInt32BE(offset, at + 8);
    directory.writeUInt32BE(data.length, at + 12);
    offset += data.length;
  });
  return Buffer.concat([directory, ...tables.map(([, data]) => data)]);
}

export const named = (postScriptName: string, platform = 3): Buffer =>
  nameTable([
    { platform, id: 1, value: 'Brand' },
    { platform, id: 6, value: postScriptName },
  ]);

/** A WOFF of the `name` table given, compressed. */
export function woff(name: Buffer): Buffer {
  // A `head` table first, stored as it is, so the `name` table is the one looked for.
  const head = Buffer.alloc(56);
  const packed = deflateSync(name);
  const header = Buffer.alloc(44 + 20 * 2);
  header.write('wOFF', 0, 'latin1');
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt16BE(2, 12);
  const tables: [string, Buffer, number][] = [
    ['head', head, head.length],
    ['name', packed, name.length],
  ];
  let offset = header.length;
  tables.forEach(([tag, data, length], i) => {
    const at = 44 + 20 * i;
    header.write(tag, at, 'latin1');
    header.writeUInt32BE(offset, at + 4);
    header.writeUInt32BE(data.length, at + 8);
    header.writeUInt32BE(length, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, head, packed]);
}

/** A collection of two fonts, which a device loads the first of. */
export function collection(first: Buffer, second: Buffer): Buffer {
  const header = Buffer.alloc(20);
  header.write('ttcf', 0, 'latin1');
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt32BE(2, 8);
  const one = sfnt(first, 0x00010000, header.length);
  header.writeUInt32BE(header.length, 12);
  header.writeUInt32BE(header.length + one.length, 16);
  return Buffer.concat([header, one, sfnt(second, 0x00010000, header.length + one.length)]);
}
