import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { deflateSync, gunzipSync } from 'node:zlib';

import { desktopAppConfig } from './app-config.mjs';
import { ar, tar, tarGz, withFolders } from './archive.mjs';
import { main, system } from './cli.mjs';
import {
  categoryList,
  checkLinuxFlags,
  dbusService,
  debControl,
  desktopEntry,
  finishArgs,
  flatpakManifest,
  flatpakProblems,
  linuxMetadata,
  linuxNames,
  metainfo,
  rpmSpec,
  selfBuiltDebWarning,
  summaryOf,
} from './package-linux.mjs';
import { decodePng, encodePng, scaleImage } from './png-icon.mjs';

const EXPO = {
  name: 'Notes',
  slug: 'notes',
  version: '2.0.0',
  description: 'Notes keeps your notes. It syncs them too.',
  icon: './assets/icon.png',
  scheme: 'notes',
  platforms: ['linux'],
  experiments: { outOfTreePlatforms: true },
  ios: { bundleIdentifier: 'com.example.notes' },
};

const APP = {
  appId: 'com.example.notes',
  packageName: 'notes',
  version: '2.0.0',
  name: 'Notes',
  summary: 'Notes keeps your notes',
  description: 'Notes keeps your notes. It syncs them too.',
  categories: ['Office', 'Utility'],
  schemes: ['notes'],
  icon: true,
  license: 'MIT',
  homepage: 'https://example.com/notes',
  maintainer: 'Ada Lovelace <ada@example.com>',
  released: '2026-11-18',
};

/** The files in a tar archive by name: their type, mode, owner and link or contents. */
function readTar(archive: Buffer) {
  const entries: Record<
    string,
    { type: string; mode: number; owner: string; link: string; data: Buffer }
  > = {};
  for (let at = 0; at + 512 <= archive.length;) {
    const header = archive.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (from: number, length: number) =>
      header.toString('utf8', from, from + length).replace(/\0.*$/s, '');
    const size = parseInt(text(124, 12), 8);
    const prefix = text(345, 155);
    const name = prefix ? `${prefix}/${text(0, 100)}` : text(0, 100);
    entries[name] = {
      type: text(156, 1),
      mode: parseInt(text(100, 8), 8),
      owner: `${text(265, 32)}:${text(297, 32)} ${parseInt(text(108, 8), 8)}:${parseInt(text(116, 8), 8)}`,
      link: text(157, 100),
      data: archive.subarray(at + 512, at + 512 + size),
    };
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

/** The members of an ar archive, in order. */
function readAr(archive: Buffer) {
  assert.equal(archive.toString('ascii', 0, 8), '!<arch>\n');
  const members: { name: string; data: Buffer }[] = [];
  for (let at = 8; at < archive.length;) {
    const name = archive.toString('ascii', at, at + 16).trim();
    const size = Number(archive.toString('ascii', at + 48, at + 58).trim());
    members.push({ name, data: archive.subarray(at + 60, at + 60 + size) });
    at += 60 + size + (size % 2);
  }
  return members;
}

describe('the archives', () => {
  it('writes a tar every file of which root owns, with its mode, links and long paths', () => {
    const long = `${'a'.repeat(90)}/${'b'.repeat(90)}`;
    const entries = readTar(
      tar(
        withFolders([
          { path: 'bin/notes', mode: 0o777, link: '../lib/notes/notes' },
          { path: 'lib/notes/notes', mode: 0o755, data: Buffer.from('#!/bin/sh\n') },
          { path: long, mode: 0o644, data: Buffer.from('x') },
        ]),
      ),
    );
    assert.deepEqual(Object.keys(entries), [
      'bin/',
      'bin/notes',
      'lib/',
      'lib/notes/',
      'lib/notes/notes',
      `${'a'.repeat(90)}/`,
      long,
    ]);
    assert.equal(entries['bin/']!.type, '5');
    assert.deepEqual(
      { type: entries['bin/notes']!.type, link: entries['bin/notes']!.link },
      { type: '2', link: '../lib/notes/notes' },
    );
    assert.equal(entries['lib/notes/notes']!.mode, 0o755);
    assert.equal(entries['lib/notes/notes']!.data.toString(), '#!/bin/sh\n');
    for (const entry of Object.values(entries)) assert.equal(entry.owner, 'root:root 0:0');
  });

  it("writes a tar the system's tar reads, with each header's checksum right", () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ngn-tar-'));
    try {
      const file = path.join(dir, 'a.tar.gz');
      writeFileSync(
        file,
        tarGz(withFolders([{ path: 'top/run', mode: 0o755, data: Buffer.from('hello') }])),
      );
      execFileSync('tar', ['-xzf', file, '-C', dir]);
      assert.equal(readFileSync(path.join(dir, 'top', 'run'), 'utf8'), 'hello');
      assert.equal(lstatSync(path.join(dir, 'top', 'run')).mode & 0o777, 0o755);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names each folder once, before the first file in it', () => {
    assert.deepEqual(
      withFolders([
        { path: 'a/b/one', mode: 0o644, data: Buffer.from('1') },
        { path: 'a/b/two', mode: 0o644, data: Buffer.from('2') },
        { path: 'a/three', mode: 0o644, data: Buffer.from('3') },
      ]).map((entry) => entry.path),
      ['a/', 'a/b/', 'a/b/one', 'a/b/two', 'a/three'],
    );
  });

  it('writes an ar archive with even-padded members, as a .deb is', () => {
    const members = readAr(
      ar([
        { name: 'debian-binary', data: Buffer.from('2.0\n') },
        { name: 'odd', data: Buffer.from('abc') },
        { name: 'last', data: Buffer.from('z') },
      ]),
    );
    assert.deepEqual(
      members.map(({ name, data }) => [name, data.toString()]),
      [
        ['debian-binary', '2.0\n'],
        ['odd', 'abc'],
        ['last', 'z'],
      ],
    );
  });
});

describe('the icon', () => {
  it('scales an icon by area, weighting colour by alpha so a clear pixel does not darken it', () => {
    // Red and a transparent black, side by side, in each row.
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0]);
    const scaled = scaleImage({ width: 2, height: 2, rgba }, 1);
    assert.deepEqual([...scaled.rgba], [255, 0, 0, 128]);
  });

  it('reads back the PNG it writes', () => {
    const image = { width: 3, height: 2, rgba: new Uint8Array(24).map((_, i) => i * 10) };
    assert.deepEqual(decodePng(encodePng(image)), image);
  });

  it("undoes each row's filter: none, sub, up, average and Paeth", () => {
    const grey = (rows: number[][], width: number, depth = 8) =>
      [
        ...decodePng(
          pngOf(0, 0, Buffer.from(rows.flat()), width, [], { height: rows.length, depth }),
        ).rgba,
      ].filter((_, index) => index % 4 === 0);
    // Sub adds the byte to the left; up the byte above.
    assert.deepEqual(
      grey(
        [
          [1, 10, 5],
          [2, 1, 2],
        ],
        2,
      ),
      [10, 15, 11, 17],
    );
    // Average adds the mean of left and above; Paeth whichever of left, above and above-left is
    // nearest left + above - above-left.
    assert.deepEqual(
      grey(
        [
          [0, 10, 20],
          [3, 5, 5],
          [4, 1, 1],
        ],
        2,
      ),
      [10, 20, 10, 20, 11, 21],
    );
    // 16 bits a channel: the high byte of each sample, and the filters step by two bytes.
    assert.deepEqual(grey([[1, 10, 99, 5, 1]], 2, 16), [10, 15]);
  });

  it('reads a palette of 1-bit, 2-bit and 4-bit indices, packed into bytes', () => {
    const colours = ['PLTE', Buffer.from([10, 0, 0, 0, 20, 0, 0, 0, 30, 40, 40, 40])] as [
      string,
      Buffer,
    ];
    const reds = (png: Buffer) => [...decodePng(png).rgba].filter((_, index) => index % 4 === 0);
    // Eight 1-bit indices in a byte, the first in the high bit: 1 0 1 1 0 0 0 1, then a short row.
    assert.deepEqual(
      reds(pngOf(3, 0, Buffer.from([0, 0b10110001, 0b10000000]), 9, [colours], { depth: 1 })),
      [0, 10, 0, 0, 10, 10, 10, 0, 0],
    );
    // 2 bits: indices 3 2 1 0 and 1.
    assert.deepEqual(
      reds(pngOf(3, 0, Buffer.from([0, 0b11100100, 0b01000000]), 5, [colours], { depth: 2 })),
      [40, 0, 0, 10, 0],
    );
    // 4 bits: indices 1 then 3, packed in one byte.
    assert.deepEqual(
      reds(pngOf(3, 0, Buffer.from([0, 0x13]), 2, [colours], { depth: 4 })),
      [0, 40],
    );
  });

  it('draws a pixel of the tRNS colour key clear, in grey and RGB and at either depth', () => {
    const alphas = (png: Buffer) => [...decodePng(png).rgba].filter((_, index) => index % 4 === 3);
    // Grey: the key is the 8-bit sample 7.
    assert.deepEqual(
      alphas(pngOf(0, 0, Buffer.from([0, 7, 9]), 2, [['tRNS', Buffer.from([0, 7])]])),
      [0, 255],
    );
    // RGB at 16 bits: the key compares whole samples, so a pixel whose high bytes match is opaque.
    const key = Buffer.from([0, 1, 0, 2, 0, 3]);
    const rgb16 = Buffer.from([0, 0, 1, 0, 2, 0, 3, 0, 1, 0, 2, 1, 3]);
    assert.deepEqual(alphas(pngOf(2, 0, rgb16, 2, [['tRNS', key]], { depth: 16 })), [0, 255]);
    // No tRNS: opaque, as before.
    assert.deepEqual(alphas(pngOf(0, 0, Buffer.from([0, 7]), 1)), [255]);
  });

  it('refuses a PNG whose data is not the size its header says, before inflating it all', () => {
    const grey = (width: number, height: number, rows: Buffer) =>
      pngOf(0, 0, rows, width, [], { height });
    // A 2 by 2 header over a stream that inflates to far more than that holds, a little more, and less.
    assert.throws(
      () => decodePng(grey(2, 2, Buffer.alloc(50 * 1024 * 1024))),
      /more than its header says/,
    );
    assert.throws(() => decodePng(grey(2, 2, Buffer.alloc(7))), /more than its header says/);
    assert.throws(() => decodePng(grey(2, 2, Buffer.alloc(5))), /not the size its header says/);
    assert.throws(
      () => decodePng(grey(5000, 1, Buffer.alloc(5001))),
      /save it at 4096 pixels a side or fewer/,
    );
    assert.equal(decodePng(grey(2, 2, Buffer.alloc(6))).width, 2);
  });

  it('reads RGB and palette PNGs, and refuses one it cannot', () => {
    const rgb = pngOf(2, 0, Buffer.from([0, 1, 2, 3]), 1);
    assert.deepEqual([...decodePng(rgb).rgba.subarray(0, 4)], [1, 2, 3, 255]);
    const palette = pngOf(3, 0, Buffer.from([0, 1]), 1, [
      ['PLTE', Buffer.from([9, 9, 9, 10, 20, 30])],
      ['tRNS', Buffer.from([255, 7])],
    ]);
    assert.deepEqual([...decodePng(palette).rgba], [10, 20, 30, 7]);
    assert.throws(() => decodePng(pngOf(2, 1, Buffer.from([0, 0, 0, 0]), 1)), /interlaced/);
    assert.throws(() => decodePng(pngOf(0, 0, Buffer.from([5, 0]), 1)), /filter 5/);
    assert.throws(() => decodePng(Buffer.from('GIF89a')), /not a PNG/);
  });
});

/** A PNG of colour `type`, interlaced or not, from its rows, each with its filter byte first. */
function pngOf(
  type: number,
  interlace: number,
  rows: Buffer,
  width: number,
  chunks: [string, Buffer][] = [],
  { height = 1, depth = 8 } = {},
) {
  const encoded = encodePng({ width, height: 1, rgba: new Uint8Array(4 * width) });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = type;
  ihdr[12] = interlace;
  const chunk = (kind: string, body: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    return Buffer.concat([length, Buffer.from(kind), body, Buffer.alloc(4)]);
  };
  return Buffer.concat([
    encoded.subarray(0, 8),
    chunk('IHDR', ihdr),
    ...chunks.map(([kind, body]) => chunk(kind, body)),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('linuxNames', () => {
  const config = desktopAppConfig(EXPO);

  it('takes the id from ios.bundleIdentifier, the package name from the slug', () => {
    assert.deepEqual(linuxNames(EXPO, config, 'deb'), {
      appId: 'com.example.notes',
      packageName: 'notes',
      version: '2.0.0',
    });
    assert.equal(linuxNames({ ...EXPO, slug: 'My Notes!' }, config, 'deb').packageName, 'my-notes');
  });

  it('makes an id up for an app build only, as macOS does', () => {
    const bare = desktopAppConfig({ ...EXPO, ios: {} });
    assert.equal(linuxNames(EXPO, bare, 'app').appId, 'dev.ngnative.notes');
    for (const format of ['deb', 'rpm', 'flatpak'] as const) {
      assert.throws(() => linuxNames(EXPO, bare, format), /Set expo.ios.bundleIdentifier/);
    }
  });

  it('makes an id from a numeric slug that no part starts with a digit', () => {
    const bare = desktopAppConfig({ ...EXPO, ios: {} });
    assert.equal(linuxNames({ ...EXPO, slug: '2048' }, bare, 'app').appId, 'dev.ngnative.app2048');
    assert.equal(linuxNames(EXPO, bare, 'app').appId, 'dev.ngnative.notes');
  });

  it("refuses a slug whose command's link would not fit a tar header", () => {
    const ok = 'a'.repeat(64);
    assert.equal(linuxNames({ ...EXPO, slug: ok }, config, 'deb').packageName, ok);
    assert.throws(
      () => linuxNames({ ...EXPO, slug: 'a'.repeat(65) }, config, 'deb'),
      /takes 64 at most/,
    );
  });

  it('refuses an id whose metainfo file name would not fit a tar header', () => {
    const named = (id: string) => desktopAppConfig({ ...EXPO, ios: { bundleIdentifier: id } });
    const fits = `com.example.${'a'.repeat(87 - 12)}`;
    assert.equal(fits.length, 87);
    assert.ok(linuxNames(EXPO, named(fits), 'deb'));
    assert.throws(() => linuxNames(EXPO, named(`${fits}a`), 'deb'), /too long/);
  });

  it("refuses an id Linux cannot take, a Flatpak's Flathub rules, and a version that is not one", () => {
    const named = (id: string) => desktopAppConfig({ ...EXPO, ios: { bundleIdentifier: id } });
    assert.throws(
      () => linuxNames(EXPO, named('notes'), 'deb'),
      /not an application id Linux takes/,
    );
    assert.throws(
      () => linuxNames(EXPO, named('com.1example.notes'), 'deb'),
      /not an application id/,
    );
    assert.ok(linuxNames(EXPO, named('com.my-company.notes'), 'deb'));
    assert.throws(
      () => linuxNames(EXPO, named('com.my-company.notes'), 'flatpak'),
      /dash only in the last/,
    );
    assert.throws(() => linuxNames(EXPO, named('example.notes'), 'flatpak'), /three to five parts/);
    assert.ok(linuxNames(EXPO, named('com.example.my-notes'), 'flatpak'));
    const versioned = desktopAppConfig({ ...EXPO, version: '2.0-beta' });
    assert.throws(() => linuxNames(EXPO, versioned, 'rpm'), /not one a Linux package takes/);
  });
});

describe('checkLinuxFlags', () => {
  it('takes the whole --homepage as one URL, with no line break to start another field', () => {
    const check = (homepage: string) => () => checkLinuxFlags({ format: 'app', homepage });
    assert.doesNotThrow(check('https://example.com/a/b?c=d#e'));
    assert.doesNotThrow(check('http://example.com'));
    for (const bad of [
      'https://example.com\nMaintainer: x',
      'https://example.com\rX',
      'https://example.com/a b',
      'https://example.com\u0000',
      'ftp://example.com',
      'https://',
    ]) {
      assert.throws(check(bad), /--homepage takes the URL/, JSON.stringify(bad));
    }
  });
});

describe('--license', () => {
  const check = (license: string) => () => checkLinuxFlags({ format: 'rpm', license });

  it('takes a whole SPDX expression and refuses an unfinished one', () => {
    for (const good of [
      'MIT',
      'Apache-2.0 OR MIT',
      '(MIT AND BSD-3-Clause) OR GPL-2.0-or-later WITH Classpath-exception-2.0',
      'GPL-3.0+',
      'LicenseRef-proprietary',
      'DocumentRef-x:LicenseRef-y',
    ]) {
      assert.doesNotThrow(check(good), good);
    }
    for (const bad of ['MIT AND', 'OR MIT', '(MIT', 'MIT)', 'MIT MIT', 'MIT WITH', 'AND', '()']) {
      assert.throws(check(bad), /--license takes an SPDX license expression/, bad);
    }
  });
});

describe('the files every Linux format installs', () => {
  it('writes a desktop entry named for the id, opening its URL schemes', () => {
    assert.equal(
      desktopEntry(APP),
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Notes',
        'Comment=Notes keeps your notes',
        'Exec=notes %U',
        'Icon=com.example.notes',
        'Terminal=false',
        'Categories=Office;Utility;',
        'MimeType=x-scheme-handler/notes;',
        'StartupWMClass=com.example.notes',
        '',
      ].join('\n'),
    );
    const plain = desktopEntry({ ...APP, icon: false, schemes: [], name: 'A\nB' });
    assert.doesNotMatch(plain, /Icon=|MimeType=|DBusActivatable/);
    assert.match(plain, /^Name=A B$/m);
  });

  it("lists the document types' MIME types before the schemes, and is D-Bus activatable with a service", () => {
    const entry = desktopEntry(
      { ...APP, mimeTypes: ['text/markdown', 'text/x-markdown'] },
      { dbusActivatable: true },
    );
    assert.match(entry, /^MimeType=text\/markdown;text\/x-markdown;x-scheme-handler\/notes;$/m);
    assert.match(entry, /^DBusActivatable=true$/m);
    assert.match(entry, /^Exec=notes %U$/m);
    assert.equal(
      dbusService(APP, '/usr'),
      '[D-BUS Service]\nName=com.example.notes\nExec=/usr/bin/notes --gapplication-service\n',
    );
  });

  it("writes metainfo from the Expo keys and package's flags, escaped", () => {
    const xml = metainfo({ ...APP, name: 'Notes & Co' });
    assert.match(xml, /<component type="desktop-application">/);
    assert.match(xml, /<id>com\.example\.notes<\/id>/);
    assert.match(xml, /<metadata_license>CC0-1.0<\/metadata_license>/);
    assert.match(xml, /<project_license>MIT<\/project_license>/);
    assert.match(xml, /<name>Notes &amp; Co<\/name>/);
    assert.match(xml, /<summary>Notes keeps your notes<\/summary>/);
    assert.match(xml, /<developer id="com\.example">\n {4}<name>Ada Lovelace<\/name>/);
    assert.match(xml, /<launchable type="desktop-id">com\.example\.notes\.desktop<\/launchable>/);
    assert.match(xml, /<url type="homepage">https:\/\/example\.com\/notes<\/url>/);
    assert.match(xml, /<binary>notes<\/binary>/);
    assert.match(xml, /<release version="2\.0\.0" date="2026-11-18" \/>/);
    const bare = metainfo({
      ...APP,
      license: undefined,
      homepage: undefined,
      maintainer: undefined,
    });
    assert.doesNotMatch(bare, /project_license|developer|<url/);
  });

  it('summarises the description by its first sentence, as AppStream asks', () => {
    assert.equal(summaryOf('Notes keeps your notes. It syncs them.'), 'Notes keeps your notes');
    assert.equal(summaryOf('One line'), 'One line');
  });

  it('takes Utility as the category, and needs a main one', () => {
    assert.deepEqual(categoryList(undefined), ['Utility']);
    assert.deepEqual(categoryList('Office, TextEditor'), ['Office', 'TextEditor']);
    assert.throws(() => categoryList('TextEditor'), /main categories/);
  });

  it('gives the host the Info.plist keys a macOS app has, and the format it was packaged as', () => {
    const config = desktopAppConfig({
      ...EXPO,
      ios: { ...EXPO.ios, buildNumber: '17' },
      runtimeVersion: '2',
      updates: { url: 'https://updates.example.com', codeSigningCertificate: './cert.pem' },
      plugins: [['@ng-native/desktop', { capabilities: { paths: [{ path: '~/Notes' }] } }]],
    });
    const metadata = JSON.parse(
      linuxMetadata(config, {
        format: 'deb',
        appId: 'com.example.notes',
        updatesCertificate: 'PEM',
      }),
    );
    assert.deepEqual(metadata, {
      CFBundleName: 'Notes',
      CFBundleIdentifier: 'com.example.notes',
      CFBundleShortVersionString: '2.0.0',
      CFBundleVersion: '17',
      NGNBundleFile: 'main.jsbundle',
      NGNModuleName: 'main',
      NGNDistribution: 'deb',
      NGNCapabilities: { paths: [{ path: '~/Notes', access: 'read' }] },
      NGNUpdatesURL: 'https://updates.example.com',
      NGNRuntimeVersion: '2',
      NGNUpdatesCodeSigningCertificate: 'PEM',
      NGNUpdatesCodeSigningKeyId: 'main',
      NGNUpdatesCodeSigningAlg: 'rsa-v1_5-sha256',
    });
    const bare = JSON.parse(linuxMetadata(desktopAppConfig(EXPO), { format: 'app', appId: 'a.b' }));
    assert.deepEqual(Object.keys(bare), [
      'CFBundleName',
      'CFBundleIdentifier',
      'CFBundleShortVersionString',
      'CFBundleVersion',
      'NGNBundleFile',
      'NGNModuleName',
      'NGNDistribution',
    ]);
  });
});

describe('the package formats', () => {
  it('writes a deb control file that depends on the GTK 4.10 and libadwaita 1.4 floor and every library the host links', () => {
    const control = debControl(APP, { arch: 'x64', installedKiB: 20480 });
    assert.match(control, /^Package: notes$/m);
    assert.match(control, /^Version: 2\.0\.0$/m);
    assert.match(control, /^Architecture: amd64$/m);
    assert.match(control, /^Maintainer: Ada Lovelace <ada@example\.com>$/m);
    assert.match(control, /^Installed-Size: 20480$/m);
    assert.match(
      control,
      /^Depends: libc6 \(>= 2\.34\), libgtk-4-1 \(>= 4\.10\), libadwaita-1-0 \(>= 1\.4\), libsecret-1-0, libgstreamer1\.0-0 \(>= 1\.22\), libgstreamer-plugins-base1\.0-0 \(>= 1\.22\), libssl3t64, libnghttp2-14, zlib1g, libsqlite3-0, libatomic1, libstdc\+\+6$/m,
    );
    assert.match(control, /^Homepage: https:\/\/example\.com\/notes$/m);
    assert.match(
      control,
      /^Description: Notes keeps your notes\n Notes keeps your notes\. It syncs them too\.\n$/m,
    );
    assert.match(debControl(APP, { arch: 'arm64', installedKiB: 1 }), /^Architecture: arm64$/m);
  });

  it('writes an rpm spec that copies the folder into /usr and names the floor', () => {
    const spec = rpmSpec({ ...APP, description: '100% notes' }, { tree: '/work/arm64/tree' });
    assert.match(spec, /^Name: notes$/m);
    assert.match(spec, /^Release: 1$/m);
    assert.match(spec, /^License: MIT$/m);
    assert.match(spec, /^Requires: gtk4 >= 4\.10$/m);
    assert.match(spec, /^Requires: libadwaita >= 1\.4$/m);
    assert.match(spec, /^%global __os_install_post %\{nil\}$/m);
    assert.match(spec, /^100%% notes$/m);
    // The build root is under the project and may have a space in its path: each command quotes it.
    assert.match(spec, /^mkdir -p "\$RPM_BUILD_ROOT\/usr"$/m);
    assert.match(spec, /^cp -a '\/work\/arm64\/tree\/\.' "\$RPM_BUILD_ROOT\/usr\/"$/m);
    assert.match(spec, /^chmod -R u\+rwX,go\+rX,go-w "\$RPM_BUILD_ROOT\/usr"$/m);
    assert.doesNotMatch(spec, /%\{buildroot\}/);
    assert.match(spec, /^\/usr\/share\/icons\/hicolor\/\*\/apps\/com\.example\.notes\.png$/m);
    assert.match(spec, /^\/usr\/share\/dbus-1\/services\/com\.example\.notes\.service$/m);
    assert.doesNotMatch(rpmSpec({ ...APP, icon: false }, { tree: '/t' }), /hicolor/);
    // A % anywhere rpm reads, and a quote in the folder's path, kept literal.
    const odd = rpmSpec(
      {
        ...APP,
        summary: 'Saves 100%{name}',
        homepage: 'https://e.com/%7E',
        maintainer: 'A% <a@b.c>',
      },
      { tree: "/Users/o'neil/50%/tree" },
    );
    assert.match(odd, /^Summary: Saves 100%%\{name\}$/m);
    assert.match(odd, /^URL: https:\/\/e\.com\/%%7E$/m);
    assert.match(odd, /^Packager: A%% <a@b\.c>$/m);
    assert.match(odd, /^cp -a '\/Users\/o'\\''neil\/50%%\/tree\/\.' "\$RPM_BUILD_ROOT\/usr\/"$/m);
  });

  it('gives a Flatpak only the permissions the app uses, and names what its sandbox takes', () => {
    const plain = desktopAppConfig(EXPO);
    assert.deepEqual(finishArgs(plain), [
      '--share=ipc',
      '--socket=wayland',
      '--socket=fallback-x11',
      '--device=dri',
      '--share=network',
    ]);
    assert.deepEqual(flatpakProblems(plain), []);
    const asks = desktopAppConfig({
      ...EXPO,
      ios: { ...EXPO.ios, infoPlist: { NSMicrophoneUsageDescription: 'To record notes.' } },
      plugins: [
        [
          '@ng-native/desktop',
          {
            capabilities: {
              spawn: [{ program: '/usr/bin/git' }],
              paths: [{ path: '~/Notes/' }, { path: '/srv/notes', access: 'readwrite' }],
            },
          },
        ],
      ],
    });
    assert.deepEqual(finishArgs(asks).slice(5), [
      '--socket=pulseaudio',
      '--filesystem=~/Notes:ro',
      '--filesystem=/srv/notes',
    ]);
    const problems = flatpakProblems(asks);
    assert.equal(problems.length, 2);
    assert.match(problems[0]!, /^capabilities\.spawn: /);
    assert.match(problems[1]!, /^capabilities\.paths: /);
    // A path under /etc or /usr is one the sandbox's runtime keeps, so the permission does nothing.
    const reserved = desktopAppConfig({
      ...EXPO,
      plugins: [
        [
          '@ng-native/desktop',
          {
            capabilities: {
              paths: [{ path: '/etc/notes' }, { path: '~/Notes' }, { path: '/etcetera' }],
            },
          },
        ],
      ],
    });
    // A colon in a path would end it and start the mode: it is escaped, and so is a backslash.
    const colon = desktopAppConfig({
      ...EXPO,
      plugins: [
        [
          '@ng-native/desktop',
          {
            capabilities: {
              paths: [{ path: '~/Notes:2026' }, { path: '~/a\\b', access: 'readwrite' }],
            },
          },
        ],
      ],
    });
    assert.deepEqual(finishArgs(colon).slice(5), [
      '--filesystem=~/Notes\\:2026:ro',
      '--filesystem=~/a\\\\b',
    ]);
    const warned = flatpakProblems(reserved).filter((line) => line.includes('keeps for its own'));
    assert.equal(warned.length, 1);
    assert.match(warned[0]!, /\/etc\/notes/);
  });

  it('writes a Flatpak manifest of each architecture as its archive, on the GNOME runtime', () => {
    const manifest = JSON.parse(
      flatpakManifest(APP, {
        finishArgs: ['--share=ipc'],
        archives: [
          { arch: 'x64', file: 'notes-2.0.0-x86_64.tar.gz', sha256: 'a' },
          { arch: 'arm64', file: 'notes-2.0.0-aarch64.tar.gz', sha256: 'b' },
        ],
      }),
    );
    assert.deepEqual(manifest, {
      id: 'com.example.notes',
      runtime: 'org.gnome.Platform',
      'runtime-version': '50',
      sdk: 'org.gnome.Sdk',
      command: 'notes',
      'finish-args': ['--share=ipc'],
      modules: [
        {
          name: 'notes',
          buildsystem: 'simple',
          'build-commands': ['cp -a bin lib share /app/'],
          sources: [
            {
              type: 'archive',
              path: 'notes-2.0.0-x86_64.tar.gz',
              sha256: 'a',
              'only-arches': ['x86_64'],
            },
            {
              type: 'archive',
              path: 'notes-2.0.0-aarch64.tar.gz',
              sha256: 'b',
              'only-arches': ['aarch64'],
            },
          ],
        },
      ],
    });
  });
});

type Call = { command: string; args: string[] };

/**
 * An app in a temporary folder, packaged for Linux through the real file system with stand-in
 * commands: the host build prints a folder holding a stand-in host and hermesc, hermesc writes the
 * file it is asked to, and every other command succeeds.
 */
function linuxApp({
  platform = 'linux',
  env = {},
  answers = {},
  expo = {},
}: {
  platform?: NodeJS.Platform;
  env?: Record<string, string>;
  answers?: Record<string, number>;
  expo?: Record<string, unknown>;
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ngn-linux-package-'));
  const app = path.join(root, 'notes');
  const build = path.join(root, 'build');
  mkdirSync(path.join(build, 'gtk'), { recursive: true });
  writeFileSync(path.join(build, 'gtk', 'ngn-linux'), '#!/bin/sh\necho host\n');
  chmodSync(path.join(build, 'gtk', 'ngn-linux'), 0o755);
  writeFileSync(path.join(build, 'gtk', 'hermesc'), '');
  mkdirSync(path.join(app, 'assets'), { recursive: true });
  const icon = new Uint8Array(64 * 64 * 4).fill(200);
  writeFileSync(
    path.join(app, 'assets', 'icon.png'),
    encodePng({ width: 64, height: 64, rgba: icon }),
  );
  const calls: Call[] = [];
  const sys: typeof system = {
    ...system,
    platform,
    arch: 'arm64',
    env,
    cwd: () => app,
    resolveReactNative: () => path.join(app, 'node_modules', 'react-native'),
    resolvePackage: () => null,
    readFile: (file: string) => (file.endsWith('prebuilt.json') ? '' : system.readFile(file)),
    expoConfig: () => ({ ...EXPO, ...expo }),
    links: () => ({
      os: 'linux' as const,
      libraries: [],
      appModules: [],
      hostLibraries: [],
      withoutDesktop: [],
      problems: [],
    }),
    expo(_from, args) {
      calls.push({ command: 'expo', args });
      const at = (flag: string) => args[args.indexOf(flag) + 1]!;
      system.writeFile(at('--bundle-output'), 'bundle');
      system.writeFile(path.join(at('--assets-dest'), 'assets', 'logo.png'), 'png');
      return { status: 0 };
    },
    warn: () => {},
    host: () => Promise.reject(new Error('package never runs the host')),
    run(command, args) {
      calls.push({ command, args });
      if (command.endsWith('build.sh')) return { status: 0, stdout: `${build}\n` };
      if (command.endsWith('hermesc')) {
        system.writeFile(args[args.indexOf('-out') + 1]!, 'bytecode');
        return { status: 0, stdout: '' };
      }
      const status = answers[`${command} ${args[0]}`] ?? 0;
      return { status, stdout: '' };
    },
  };
  return { root, app, sys, calls };
}

const quiet = async <T>(work: () => Promise<T>): Promise<T> => {
  const log = console.log;
  console.log = () => {};
  try {
    return await work();
  } finally {
    console.log = log;
  }
};

const LICENSED = ['--license', 'MIT'];

describe('ng-native-desktop package --os linux', () => {
  it('makes a runnable folder and its .tar.gz for each architecture asked', async () => {
    const { root, app, sys, calls } = linuxApp();
    try {
      const status = await quiet(() => main(['package', '--arch', 'arm64'], sys));
      assert.equal(status, 0);
      // Bundled for linux once, compiled by the hermesc beside the host built for this machine.
      assert.deepEqual(calls.find((call) => call.command === 'expo')!.args.slice(0, 2), [
        'export:embed',
        '--platform',
      ]);
      assert.ok(calls.some((call) => call.args.includes('linux') && call.command === 'expo'));
      const built = calls.find((call) => call.command.endsWith('build.sh'))!;
      assert.deepEqual(built.args.slice(1), ['--backend', 'gtk', '--release']);

      const folder = path.join(app, 'dist', 'linux', 'notes-2.0.0-aarch64');
      const lib = path.join(folder, 'lib', 'notes');
      assert.equal(readlinkSync(path.join(folder, 'bin', 'notes')), '../lib/notes/ngn-app');
      assert.equal(readFileSync(path.join(lib, 'ngn-app'), 'utf8'), '#!/bin/sh\necho host\n');
      assert.equal(lstatSync(path.join(lib, 'ngn-app')).mode & 0o777, 0o755);
      assert.equal(readFileSync(path.join(lib, 'main.jsbundle'), 'utf8'), 'bytecode');
      assert.equal(readFileSync(path.join(lib, 'assets', 'logo.png'), 'utf8'), 'png');
      assert.equal(
        JSON.parse(readFileSync(path.join(lib, 'metadata.json'), 'utf8')).NGNDistribution,
        'app',
      );
      assert.match(
        readFileSync(
          path.join(folder, 'share', 'applications', 'com.example.notes.desktop'),
          'utf8',
        ),
        /^Icon=com\.example\.notes$/m,
      );
      assert.ok(
        existsSync(path.join(folder, 'share', 'metainfo', 'com.example.notes.metainfo.xml')),
      );
      // Each hicolor size up to the icon's own 64.
      for (const size of [16, 24, 32, 48, 64]) {
        const png = path.join(
          folder,
          'share',
          'icons',
          'hicolor',
          `${size}x${size}`,
          'apps',
          'com.example.notes.png',
        );
        assert.equal(decodePng(readFileSync(png)).width, size);
      }
      assert.ok(!existsSync(path.join(folder, 'share', 'icons', 'hicolor', '128x128')));
      assert.ok(!existsSync(path.join(app, 'dist', 'linux', 'notes-2.0.0-x86_64')));

      const entries = readTar(gunzipSync(readFileSync(`${folder}.tar.gz`)));
      assert.equal(entries['notes-2.0.0-aarch64/bin/notes']!.link, '../lib/notes/ngn-app');
      assert.equal(entries['notes-2.0.0-aarch64/lib/notes/ngn-app']!.mode, 0o755);
      assert.ok(entries['notes-2.0.0-aarch64/share/applications/com.example.notes.desktop']);
      // A folder runs from wherever it is unpacked, so the bus has no path to start it by.
      assert.doesNotMatch(
        entries[
          'notes-2.0.0-aarch64/share/applications/com.example.notes.desktop'
        ]!.data.toString(),
        /DBusActivatable/,
      );
      assert.ok(!entries['notes-2.0.0-aarch64/share/dbus-1/services/com.example.notes.service']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('makes a .deb whose data installs into /usr, owned by root', async () => {
    const { root, app, sys } = linuxApp();
    const warned: string[] = [];
    try {
      await quiet(() =>
        main(
          [
            'package',
            '--format',
            'deb',
            '--arch',
            'arm64',
            '--maintainer',
            'Ada <ada@example.com>',
          ],
          { ...sys, warn: (line: string) => void warned.push(line) },
        ),
      );
      // Built here, not the prebuilt AlmaLinux 9 host the dependency floors hold for.
      assert.deepEqual(
        warned.filter((line) => line.includes('built on this machine')),
        [selfBuiltDebWarning('arm64')],
      );
      assert.match(warned.join('\n'), /glibc 2\.34[\s\S]*AlmaLinux 9/);
      const members = readAr(
        readFileSync(path.join(app, 'dist', 'linux', 'notes_2.0.0_arm64.deb')),
      );
      assert.deepEqual(
        members.map((member) => member.name),
        ['debian-binary', 'control.tar.gz', 'data.tar.gz'],
      );
      assert.equal(members[0]!.data.toString(), '2.0\n');
      const control = readTar(gunzipSync(members[1]!.data))['./control']!.data.toString();
      assert.match(control, /^Architecture: arm64$/m);
      assert.match(control, /^Maintainer: Ada <ada@example\.com>$/m);
      const data = readTar(gunzipSync(members[2]!.data));
      assert.equal(data['./usr/bin/notes']!.link, '../lib/notes/ngn-app');
      assert.equal(data['./usr/lib/notes/ngn-app']!.mode, 0o755);
      assert.ok(data['./usr/share/metainfo/com.example.notes.metainfo.xml']);
      assert.match(
        data['./usr/share/applications/com.example.notes.desktop']!.data.toString(),
        /^DBusActivatable=true$/m,
      );
      assert.match(
        data['./usr/share/dbus-1/services/com.example.notes.service']!.data.toString(),
        /^Exec=\/usr\/bin\/notes --gapplication-service$/m,
      );
      assert.equal(Object.keys(data)[0], './');
      for (const entry of Object.values(data)) assert.equal(entry.owner, 'root:root 0:0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('builds an rpm with rpmbuild --target on Linux, signing it with NGN_GPG_KEY', async () => {
    const { root, app, sys, calls } = linuxApp({ env: { NGN_GPG_KEY: 'ABCD' } });
    try {
      await quiet(() => main(['package', '--format', 'rpm', '--arch', 'arm64', ...LICENSED], sys));
      const run = calls.find((call) => call.command === 'sh')!;
      const script = readFileSync(run.args[0]!, 'utf8');
      assert.match(
        script,
        /^rpmbuild -bb --target aarch64 --define '_topdir .*\/arm64\/rpm' '.*\/notes\.spec'$/m,
      );
      assert.match(
        script,
        /^rpmsign --addsign --define '_gpg_name ABCD' '.*notes-2\.0\.0-1\.aarch64\.rpm'$/m,
      );
      // Compared as text: a temp directory named "ci[1]" is no regular expression.
      const copy = script.split('\n').find((line) => line.startsWith('cp '))!;
      assert.ok(
        copy.endsWith(` '${path.join(app, 'dist', 'linux')}/notes-2.0.0-1.aarch64.rpm'`),
        copy,
      );
      // The user's own GPG home and agent on Linux: no copy.
      assert.doesNotMatch(script, /GNUPGHOME/);
      assert.ok(!calls.some((call) => call.command === 'docker'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs rpmbuild in a container that gets an output folder and gives back what it wrote, on exit', async () => {
    const make = (engine: 'docker' | 'podman') => {
      const made = linuxApp({
        answers: {
          'rpmbuild --version': 1,
          ...(engine === 'podman' ? { 'docker info': 1 } : {}),
          [`${engine} image`]: 1,
        },
      });
      const out = path.join(made.app, 'dist', 'linux');
      let outputAtRun: boolean | undefined;
      const run = made.sys.run;
      made.sys.run = (command, args, options) => {
        if (command === engine && args[0] === 'run') outputAtRun = existsSync(out);
        return run(command, args, options);
      };
      return { ...made, out, ran: () => outputAtRun };
    };
    const docker = make('docker');
    const podman = make('podman');
    try {
      for (const { sys } of [docker, podman]) {
        await quiet(() =>
          main(['package', '--format', 'rpm', '--arch', 'arm64', ...LICENSED], sys),
        );
      }
      const scriptOf = (calls: Call[], engine: string) =>
        readFileSync(
          calls.find((call) => call.command === engine && call.args[0] === 'run')!.args.at(-1)!,
          'utf8',
        );
      // Both engines bind-mount the output folder, which exists first.
      assert.equal(docker.ran(), true);
      assert.equal(podman.ran(), true);
      // Rootful Docker writes as root: ownership comes back whether rpmbuild passes or fails.
      const lines = scriptOf(docker.calls, 'docker').split('\n');
      assert.match(lines[1]!, /^ngn_restore\(\) \{ chown -R \d+:\d+ .* \|\| true; \}$/);
      assert.equal(lines[2], 'trap ngn_restore EXIT');
      assert.ok(lines.findIndex((line) => line.startsWith('rpmbuild ')) > 2);
      // Rootless Podman's container root is this user: a host UID given to chown is a subordinate one.
      assert.doesNotMatch(scriptOf(podman.calls, 'podman'), /chown|ngn_restore/);
    } finally {
      rmSync(docker.root, { recursive: true, force: true });
      rmSync(podman.root, { recursive: true, force: true });
    }
  });

  it('keeps the host apart from metadata.json whatever the slug is', async () => {
    const { root, app, sys } = linuxApp({ expo: { slug: 'metadata.json' } });
    try {
      await quiet(() => main(['package', '--arch', 'arm64'], sys));
      const folder = path.join(app, 'dist', 'linux', 'metadata.json-2.0.0-aarch64');
      const lib = path.join(folder, 'lib', 'metadata.json');
      assert.equal(readFileSync(path.join(lib, 'ngn-app'), 'utf8'), '#!/bin/sh\necho host\n');
      const metadata = JSON.parse(readFileSync(path.join(lib, 'metadata.json'), 'utf8'));
      assert.equal(metadata.NGNDistribution, 'app');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('removes the signature of an earlier build when it ships the archive unsigned', async () => {
    const { root, app, sys } = linuxApp();
    try {
      const stale = path.join(app, 'dist', 'linux', 'notes-2.0.0-aarch64.tar.gz.asc');
      mkdirSync(path.dirname(stale), { recursive: true });
      writeFileSync(stale, 'old signature');
      await quiet(() => main(['package', '--arch', 'arm64'], sys));
      assert.ok(existsSync(path.join(app, 'dist', 'linux', 'notes-2.0.0-aarch64.tar.gz')));
      assert.ok(!existsSync(stale));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs rpmbuild in the AlmaLinux 9 container from a Mac, which needs a prebuilt Linux host', async () => {
    const { root, sys } = linuxApp({ platform: 'darwin' });
    try {
      // No prebuilt Linux host yet, and a Mac builds none.
      await assert.rejects(
        packageWith(sys, ['--format', 'deb', '--maintainer', 'A <a@b.c>']),
        /The Linux desktop host builds on Linux only for now[\s\S]*no prebuilt Linux x64 host/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not build an x64 host on a machine of another architecture, such as riscv64', async () => {
    const { root, sys, calls } = linuxApp();
    try {
      await assert.rejects(
        packageWith({ ...sys, arch: 'riscv64' }, ['--arch', 'x64']),
        /builds on Linux only for now[\s\S]*no prebuilt Linux x64 host/,
      );
      assert.ok(!calls.some((call) => call.command.endsWith('build.sh')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('packages on a Mac from the prebuilt Linux host, compiling with the macOS host hermesc', async () => {
    const { root, app, sys, calls } = linuxApp({ platform: 'darwin' });
    const cache = path.join(root, 'cache');
    const sha = { linux: 'a'.repeat(64), macos: 'b'.repeat(64) };
    const unpacked = (hash: string, file: string) => {
      const at = path.join(cache, 'rn-0.88.0', 'prebuilt', hash.slice(0, 16), file);
      mkdirSync(path.dirname(at), { recursive: true });
      writeFileSync(at, '#!/bin/sh\necho prebuilt\n');
      chmodSync(at, 0o755);
    };
    unpacked(sha.linux, 'gtk/ngn-linux');
    unpacked(sha.macos, 'appkit/ngn-macos');
    const manifest = {
      version: 1,
      hosts: [
        {
          reactNative: '0.88.0',
          os: 'linux',
          arch: 'x64',
          url: 'https://e.com/l.tar.gz',
          sha256: sha.linux,
          libraries: {},
        },
        { reactNative: '0.88.0', url: 'https://e.com/m.tar.gz', sha256: sha.macos, libraries: {} },
      ],
    };
    const warned: string[] = [];
    const mac: typeof system = {
      ...sys,
      warn: (line: string) => void warned.push(line),
      env: { NGN_DESKTOP_CACHE: cache },
      readFile: (file: string) =>
        file.endsWith('prebuilt.json')
          ? JSON.stringify(manifest)
          : file.endsWith(path.join('react-native', 'package.json'))
            ? JSON.stringify({ version: '0.88.0' })
            : system.readFile(file),
    };
    try {
      await quiet(() =>
        main(
          [
            'package',
            '--os',
            'linux',
            '--arch',
            'x64',
            '--format',
            'deb',
            '--maintainer',
            'A <a@b.c>',
          ],
          mac,
        ),
      );
      // Nothing built: the bytecode comes from the macOS host's hermesc, the binary from Linux's.
      assert.ok(!calls.some((call) => call.command.endsWith('build.sh')));
      const hermesc = calls.find((call) => call.command.endsWith('hermesc'))!;
      assert.equal(
        hermesc.command,
        path.join(cache, 'rn-0.88.0', 'prebuilt', 'bbbbbbbbbbbbbbbb', 'appkit', 'hermesc'),
      );
      const members = readAr(
        readFileSync(path.join(app, 'dist', 'linux', 'notes_2.0.0_amd64.deb')),
      );
      const data = readTar(gunzipSync(members[2]!.data));
      assert.equal(data['./usr/lib/notes/ngn-app']!.data.toString(), '#!/bin/sh\necho prebuilt\n');
      // The prebuilt host is the one the .deb's dependency floors are for.
      assert.ok(!warned.some((line) => line.includes('built on this machine')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('signs the .tar.gz with NGN_GPG_KEY, beside it', async () => {
    const { root, app, sys, calls } = linuxApp({ env: { NGN_GPG_KEY: 'ABCD' } });
    try {
      await quiet(() => main(['package', '--arch', 'arm64'], sys));
      const archive = path.join(app, 'dist', 'linux', 'notes-2.0.0-aarch64.tar.gz');
      const gpg = calls.find(
        (call) => call.command === 'gpg' && call.args.includes('--detach-sign'),
      )!;
      assert.deepEqual(gpg.args, [
        '--batch',
        '--yes',
        '--armor',
        '--local-user',
        'ABCD',
        '--detach-sign',
        '--output',
        `${archive}.asc`,
        archive,
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('names what is missing before it builds anything: Docker or Podman, a description, gpg', async () => {
    const noEngine = linuxApp({
      answers: { 'rpmbuild --version': 1, 'docker info': 1, 'podman info': 1 },
    });
    const noDescription = linuxApp({ expo: { description: undefined } });
    const noGpg = linuxApp({ env: { NGN_GPG_KEY: 'ABCD' }, answers: { 'gpg --version': 1 } });
    try {
      await assert.rejects(
        packageWith(noEngine.sys, ['--format', 'rpm', ...LICENSED]),
        /runs rpmbuild, and this machine has no rpmbuild, or Docker or Podman running to run it in a container/,
      );
      await assert.rejects(packageWith(noDescription.sys, []), /has no expo\.description/);
      await assert.rejects(packageWith(noGpg.sys, []), /gpg is not installed/);
      const oblong = path.join(noDescription.app, 'assets', 'icon.png');
      writeFileSync(oblong, encodePng({ width: 4, height: 2, rgba: new Uint8Array(32) }));
      await assert.rejects(
        packageWith(linuxAppIn(noDescription.sys), ['--arch', 'arm64']),
        /is 4 by 2; Linux icons are square/,
      );
      for (const { calls } of [noEngine, noDescription, noGpg]) {
        assert.ok(
          !calls.some((call) => call.command.endsWith('build.sh') || call.command === 'expo'),
        );
      }
    } finally {
      for (const { root } of [noEngine, noDescription, noGpg])
        rmSync(root, { recursive: true, force: true });
    }
  });

  it('builds a Flatpak in the container when Linux has no flatpak-builder, into a repo and bundles', async () => {
    const { root, app, sys, calls } = linuxApp({
      answers: { 'flatpak-builder --version': 1, 'docker image': 1 },
      env: { NGN_GPG_KEY: 'ABCD', GNUPGHOME: '/keys/gnupg' },
    });
    try {
      // An earlier signed `app` build of the same version, which a Flatpak must leave alone.
      const out = path.join(app, 'dist', 'linux');
      mkdirSync(out, { recursive: true });
      writeFileSync(path.join(out, 'notes-2.0.0-aarch64.tar.gz'), 'the app archive');
      writeFileSync(path.join(out, 'notes-2.0.0-aarch64.tar.gz.asc'), 'its signature');
      await quiet(() =>
        main(['package', '--format', 'flatpak', '--arch', 'arm64', ...LICENSED], sys),
      );
      assert.equal(
        readFileSync(path.join(out, 'notes-2.0.0-aarch64.tar.gz'), 'utf8'),
        'the app archive',
      );
      const manifest = JSON.parse(readFileSync(path.join(out, 'com.example.notes.json'), 'utf8'));
      const source = manifest.modules[0].sources[0];
      assert.equal(source.path, 'notes-2.0.0-aarch64-flatpak-source.tar.gz');
      assert.ok(existsSync(path.join(out, source.path)));
      // The image is built first when it is missing, then the script runs privileged in it.
      assert.equal(
        calls.find((call) => call.command === 'docker' && call.args[0] === 'build')!.args[1],
        '-t',
      );
      const run = calls.find((call) => call.command === 'docker' && call.args[0] === 'run')!;
      assert.ok(run.args.includes('--privileged'));
      assert.ok(run.args.includes(`${out}:${out}`));
      const script = readFileSync(run.args.at(-1)!, 'utf8');
      assert.match(
        script,
        /^flatpak-builder --user --arch=aarch64 --install-deps-from=flathub --force-clean --disable-rofiles-fuse /m,
      );
      assert.ok(script.includes(`--repo='${out}/flatpak-repo'`));
      assert.match(
        script,
        /^flatpak build-bundle --arch=aarch64 .* 'com\.example\.notes' stable$/m,
      );
      assert.match(script, /^flatpak build-update-repo --generate-static-deltas /m);
      assert.match(script, /^ngn_restore\(\) \{ chown -R \d+:\d+ /m);
      assert.match(script, /^trap 'rm -rf "\$work" 2>\/dev\/null \|\| true; ngn_restore' EXIT$/m);
      // The key's home, mounted read-only and copied, since gpg writes to its home.
      assert.ok(run.args.includes('/keys/gnupg:/gnupg:ro'));
      assert.match(script, /^rm -rf \/tmp\/gnupg && cp -r \/gnupg \/tmp\/gnupg/m);
      assert.match(script, /^export GNUPGHOME=\/tmp\/gnupg$/m);
      assert.match(script, / --repo='[^']*' --gpg-sign='ABCD' /);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/** `sys` with the description back, so packaging gets as far as the icon. */
function linuxAppIn(sys: typeof system): typeof system {
  return {
    ...sys,
    expoConfig: (from: string) => ({ ...sys.expoConfig(from), description: EXPO.description }),
  };
}

/** Packages with `args` for Linux, failing with the error rather than the usage text. */
async function packageWith(sys: typeof system, args: string[]) {
  const { packageApp, parsePackage } = await import('./package.mjs');
  return quiet(() => packageApp(parsePackage(['--os', 'linux', ...args], 'darwin'), sys));
}
