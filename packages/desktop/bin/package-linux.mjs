/**
 * `ng-native-desktop package --os linux`: the app as something to hand to someone on Linux, one
 * package per architecture.
 *
 * - `--format app` (the default): a runnable folder, `bin/`, `lib/` and `share/` as a prefix lays
 *   them out, and the same folder as a `.tar.gz`, with a detached GPG signature when `NGN_GPG_KEY`
 *   names a key.
 * - `--format deb`: for Debian and Ubuntu, on the system's GTK, written in JavaScript.
 * - `--format rpm`: for Fedora and the RHEL family, on the system's GTK, by `rpmbuild`, which writes
 *   the libraries the binary links as requirements; signed by `rpmsign` with `NGN_GPG_KEY`.
 * - `--format flatpak`: sandboxed, on the GNOME runtime: a `.flatpak` bundle per architecture, an
 *   OSTree repository to serve as the app's own remote (signed with `NGN_GPG_KEY`), and the manifest
 *   it was built from. What the sandbox takes away is named before it is built.
 *
 * Each installs `<app id>.desktop`, the icon in the hicolor theme's sizes and
 * `<app id>.metainfo.xml`, and the host reads its settings from `metadata.json` beside the bundle,
 * as a macOS app reads its `Info.plist`. The JavaScript is compiled to Hermes bytecode once, for
 * every architecture: the bytecode does not depend on one. The packages carry no updater of their
 * own: the package manager or Flatpak updates the app, and Expo Updates its JavaScript.
 *
 * `app` and `deb` need no tools beyond Node. `rpm` and `flatpak` run `rpmbuild` and
 * `flatpak-builder`, on Linux when they are installed and otherwise in a container through Docker or
 * Podman (AlmaLinux 9 for rpm, Fedora 44 for flatpak), which is how a Mac makes them.
 */
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

import { desktopAppConfig, hostCapabilities } from './app-config.mjs';
import { ar, tarGz, withFolders } from './archive.mjs';
import {
  linuxHermesCompiler,
  prepareHost,
  readExpoConfig,
  resolveReactNative,
  UsageError,
} from './host.mjs';
import { escape } from './plist.mjs';
import { decodePng, encodePng, scaleImage } from './png-icon.mjs';

/**
 * @typedef {import('./host.mjs').system} System
 * @typedef {import('./app-config.mjs').DesktopAppConfig} DesktopAppConfig
 * @typedef {import('./app-config.mjs').ExpoConfig} ExpoConfig
 * @typedef {import('./archive.mjs').ArchiveEntry} ArchiveEntry
 * @typedef {'x64' | 'arm64'} LinuxArch
 * @typedef {'app' | 'deb' | 'rpm' | 'flatpak'} LinuxFormat
 * @typedef {{ format: LinuxFormat, arch: LinuxArch | 'all', output: string, license?: string, homepage?: string, categories?: string, maintainer?: string }} LinuxPackageCommand
 */

export const LINUX_FORMATS = /** @type {const} */ (['app', 'deb', 'rpm', 'flatpak']);

/** Each architecture by the name each format gives it. */
export const LINUX_ARCHES = {
  x64: { deb: 'amd64', rpm: 'x86_64', flatpak: 'x86_64' },
  arm64: { deb: 'arm64', rpm: 'aarch64', flatpak: 'aarch64' },
};

/**
 * The oldest of each system library a `deb` or `rpm` runs on: Ubuntu 24.04, Debian 13 and Fedora 44
 * have newer, and the host is built against AlmaLinux 9's glibc. A Flatpak brings its own.
 */
export const LINUX_MINIMUMS = { glibc: '2.34', gtk: '4.10', libadwaita: '1.4', gstreamer: '1.22' };

/** The GNOME runtime a Flatpak runs on, a new one each year. */
export const FLATPAK_RUNTIME = {
  runtime: 'org.gnome.Platform',
  sdk: 'org.gnome.Sdk',
  version: '50',
};

/** The hicolor sizes the icon is scaled to, up to the size it is. */
export const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

/** The freedesktop main categories, one of which a desktop entry needs. */
const MAIN_CATEGORIES = [
  'AudioVideo',
  'Audio',
  'Video',
  'Development',
  'Education',
  'Game',
  'Graphics',
  'Network',
  'Office',
  'Science',
  'Settings',
  'System',
  'Utility',
];

/**
 * The longest package name. `bin/<name>` links to `../lib/<name>/ngn-app`, which a tar header holds
 * at 100 bytes or fewer, and this keeps it well within.
 */
const MAX_SLUG = 64;

/** The host's file in `lib/<name>/`, named the same for every app so that no slug can name another file there. */
const HOST_FILE = 'ngn-app';

/** The file the bundle is in, beside the host, as on macOS. */
const BUNDLE_FILE = 'main.jsbundle';

/** The license of the generated metainfo itself, which AppStream asks for. */
const METADATA_LICENSE = 'CC0-1.0';

/**
 * The flags `--os linux` takes, checked: `--categories` a list of freedesktop categories with a main
 * one, `--homepage` an https URL, and `--license` an SPDX expression, which an rpm and a Flatpak
 * need.
 *
 * @param {{ format: string, license?: string, homepage?: string, categories?: string, maintainer?: string }} values
 */
export function checkLinuxFlags({ format, license, homepage, categories, maintainer }) {
  if (license === undefined && (format === 'rpm' || format === 'flatpak')) {
    throw new UsageError(
      `--format ${format} needs --license, the app's SPDX license (MIT, GPL-3.0-or-later, ` +
        'LicenseRef-proprietary), which the package and its metainfo state.',
    );
  }
  if (license !== undefined && !/^[A-Za-z0-9.+\-:() ]+$/.test(license)) {
    throw new UsageError(`--license takes an SPDX license expression, not "${license}".`);
  }
  if (homepage !== undefined && !isWebUrl(homepage)) {
    throw new UsageError(`--homepage takes the URL of the app's page, not "${homepage}".`);
  }
  if (categories !== undefined) categoryList(categories);
  checkMaintainer(format, maintainer);
}

/**
 * Whether `value` is, all of it, an http or https URL with a host: no whitespace or control
 * character, which would end the field it is written into and start another.
 *
 * @param {string} value
 */
function isWebUrl(value) {
  if (/[\u0000-\u0020\u007f-\u009f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * `--maintainer`: a name and an email, which a deb needs.
 *
 * @param {string} format
 * @param {string | undefined} maintainer
 */
function checkMaintainer(format, maintainer) {
  if (maintainer === undefined && format === 'deb') {
    throw new UsageError(
      '--format deb needs --maintainer, the name and email a Debian package names as its ' +
        'maintainer: --maintainer "Ada Lovelace <ada@example.com>".',
    );
  }
  if (maintainer !== undefined && !/^[^<>\n]+ <[^<>\s@]+@[^<>\s]+>$/.test(maintainer)) {
    throw new UsageError(
      `--maintainer takes a name and an email, as "Ada Lovelace <ada@example.com>", not "${maintainer}".`,
    );
  }
}

/**
 * `--categories` as a list, `Utility` when none are given. Throws unless one is a main category.
 *
 * @param {string | undefined} categories
 */
export function categoryList(categories) {
  if (categories === undefined) return ['Utility'];
  const list = categories
    .split(/[;,]/)
    .map((each) => each.trim())
    .filter(Boolean);
  const bad = list.find((each) => !/^[A-Za-z0-9-]+$/.test(each));
  if (bad !== undefined)
    throw new UsageError(`--categories has "${bad}", which is not a category.`);
  if (!list.some((each) => MAIN_CATEGORIES.includes(each))) {
    throw new UsageError(
      `--categories needs one of the main categories: ${MAIN_CATEGORIES.join(', ')}.`,
    );
  }
  return [...new Set(list)];
}

/**
 * The last part of the id made up for an `app` build: the slug's letters and digits, and `app` before
 * a first digit, which a part of an id cannot start with (`2048` is `app2048`).
 *
 * @param {string} slug
 */
function idPart(slug) {
  const letters = slug.replace(/[^a-z0-9]/g, '') || 'app';
  return /^\d/.test(letters) ? `app${letters}` : letters;
}

/**
 * The application id `linuxNames` gives a package, checked for Linux and, for a Flatpak, Flathub.
 *
 * @param {string | null} bundleIdentifier
 * @param {LinuxFormat} format
 * @param {string} slug
 */
function linuxAppId(bundleIdentifier, format, slug) {
  if (bundleIdentifier === null && format !== 'app') {
    throw new UsageError(
      `--format ${format} names the app's files and its desktop entry by its id, and app.json ` +
        'sets none. Set expo.ios.bundleIdentifier, which the desktop OSes share with iOS.',
    );
  }
  const appId = bundleIdentifier ?? `dev.ngnative.${idPart(slug)}`;
  const part = /^[A-Za-z_][A-Za-z0-9_-]*$/;
  const parts = appId.split('.');
  if (parts.length < 2 || !parts.every((each) => part.test(each)) || appId.length > 255) {
    throw new UsageError(
      `The bundle identifier "${appId}" is not an application id Linux takes: two or more parts ` +
        'of letters, digits, _ and -, none starting with a digit.',
    );
  }
  const flathub =
    parts.length >= 3 &&
    parts.length <= 5 &&
    parts.slice(0, -1).every((each) => !each.includes('-'));
  if (format === 'flatpak' && !flathub) {
    throw new UsageError(
      `A Flatpak's id has three to five parts with a dash only in the last, and "${appId}" does ` +
        'not. Change expo.ios.bundleIdentifier, or package another format.',
    );
  }
  return appId;
}

/**
 * The names a Linux package goes by: the application id, which names the desktop entry, the icon and
 * the metainfo and is the host's GApplication id; the package and command name, from the slug; and
 * the version. Throws a usage error for one the format cannot take.
 *
 * - The id is `ios.bundleIdentifier`, which the desktop OSes share with iOS. An `app` build makes one
 *   up from the slug when the app sets none, as a macOS `app` build does; the others need it. A
 *   Flatpak's id has three to five parts with a dash only in the last, as Flathub asks.
 *
 * @param {ExpoConfig} expo
 * @param {DesktopAppConfig} config
 * @param {LinuxFormat} format
 */
export function linuxNames(expo, config, format) {
  const slug = String(expo.slug ?? config.name)
    .toLowerCase()
    .replace(/[^a-z0-9+.-]+/g, '-')
    .replace(/^[^a-z0-9]+|[-.]+$/g, '');
  if (slug.length < 2) {
    throw new UsageError(
      `The slug "${expo.slug ?? config.name}" makes no package name, which needs two letters or ` +
        'digits. Set expo.slug in app.json.',
    );
  }
  if (slug.length > MAX_SLUG) {
    throw new UsageError(
      `The slug "${slug}" makes a package name of ${slug.length} characters, and a Linux package ` +
        `takes ${MAX_SLUG} at most. Shorten expo.slug in app.json.`,
    );
  }
  const appId = linuxAppId(config.bundleIdentifier, format, slug);
  const version = config.version;
  if (!/^\d[A-Za-z0-9.+~]*$/.test(version)) {
    throw new UsageError(
      `The version "${version}" is not one a Linux package takes: a digit first, then letters, ` +
        'digits, ., + and ~. Change "version" in app.json.',
    );
  }
  return { appId, packageName: slug, version };
}

/**
 * @typedef {{ appId: string, packageName: string, version: string }} LinuxNames
 * @typedef {LinuxNames & { name: string, summary: string, description: string, categories: string[], schemes: string[], mimeTypes?: string[], icon: boolean, license?: string, homepage?: string, maintainer?: string, released: string }} LinuxApp
 */

/**
 * A desktop entry value: one line, with the spec's escapes.
 *
 * @param {string} value
 */
function entryValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, ' ').replace(/\t/g, ' ');
}

/**
 * Where each installed format puts the app's tree; the `app` folder runs from wherever it is
 * unpacked, so it has none.
 *
 * @type {Partial<Record<LinuxFormat, string>>}
 */
export const LINUX_PREFIX = { deb: '/usr', rpm: '/usr', flatpak: '/app' };

/**
 * The app's desktop entry, `<app id>.desktop`, which launchers list it by. Its document types'
 * MIME types and its URL schemes, as `x-scheme-handler` types, are what it opens: with the files
 * or the link in `%U`, or, where it is installed with its D-Bus service (`dbusActivatable`), through
 * the session bus, which starts it if it is not running and hands a running one the files or
 * the link. Wayland matches the window to the entry by its name, the host's app id.
 *
 * @param {LinuxApp} app
 * @param {{ dbusActivatable?: boolean }} [options]
 */
export function desktopEntry(app, { dbusActivatable = false } = {}) {
  const types = [
    ...(app.mimeTypes ?? []),
    ...app.schemes.map((scheme) => `x-scheme-handler/${scheme}`),
  ];
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${entryValue(app.name)}`,
    `Comment=${entryValue(app.summary)}`,
    `Exec=${app.packageName} %U`,
    ...(app.icon ? [`Icon=${app.appId}`] : []),
    'Terminal=false',
    ...(dbusActivatable ? ['DBusActivatable=true'] : []),
    `Categories=${app.categories.join(';')};`,
    ...(types.length > 0 ? [`MimeType=${types.map((type) => `${type};`).join('')}`] : []),
    `StartupWMClass=${app.appId}`,
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * The app's D-Bus service, `<app id>.service`, which lets the session bus start it by its id for
 * a desktop entry with `DBusActivatable=true`. The host takes `--gapplication-service` to start as
 * that service.
 *
 * @param {LinuxApp} app
 * @param {string} prefix where the format installs the tree (LINUX_PREFIX)
 */
export function dbusService(app, prefix) {
  return [
    '[D-BUS Service]',
    `Name=${app.appId}`,
    `Exec=${prefix}/bin/${app.packageName} --gapplication-service`,
    '',
  ].join('\n');
}

/**
 * The app's AppStream metainfo, `<app id>.metainfo.xml`, which GNOME Software, Discover and a
 * Flatpak remote list it by: the Expo `name`, `description` and `version`, and what `package` was
 * told of the license, the homepage and the developer.
 *
 * @param {LinuxApp} app
 */
export function metainfo(app) {
  const developer = app.maintainer?.replace(/\s*<.*$/, '');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<component type="desktop-application">',
    `  <id>${escape(app.appId)}</id>`,
    `  <metadata_license>${METADATA_LICENSE}</metadata_license>`,
    ...(app.license ? [`  <project_license>${escape(app.license)}</project_license>`] : []),
    `  <name>${escape(app.name)}</name>`,
    `  <summary>${escape(app.summary)}</summary>`,
    ...(developer
      ? [
          `  <developer id="${escape(app.appId.split('.').slice(0, -1).join('.'))}">`,
          `    <name>${escape(developer)}</name>`,
          '  </developer>',
        ]
      : []),
    '  <description>',
    `    <p>${escape(app.description)}</p>`,
    '  </description>',
    `  <launchable type="desktop-id">${escape(app.appId)}.desktop</launchable>`,
    ...(app.homepage ? [`  <url type="homepage">${escape(app.homepage)}</url>`] : []),
    '  <provides>',
    `    <binary>${escape(app.packageName)}</binary>`,
    '  </provides>',
    '  <content_rating type="oars-1.1" />',
    '  <releases>',
    `    <release version="${escape(app.version)}" date="${app.released}" />`,
    '  </releases>',
    '</component>',
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * What the host reads before JavaScript runs, beside the bundle: the keys a macOS app's
 * `Info.plist` gives it, so one lookup in the core serves both. The format names the package, so
 * `Updates` knows no whole-app updater is built in.
 *
 * @param {DesktopAppConfig} config
 * @param {{ format: LinuxFormat, appId: string, updatesCertificate?: string }} options
 */
export function linuxMetadata(config, { format, appId, updatesCertificate }) {
  const signing = updatesCertificate
    ? {
        NGNUpdatesCodeSigningCertificate: updatesCertificate,
        NGNUpdatesCodeSigningKeyId: config.updatesCodeSigning?.keyId ?? 'main',
        NGNUpdatesCodeSigningAlg: config.updatesCodeSigning?.alg ?? 'rsa-v1_5-sha256',
      }
    : {};
  const all = {
    CFBundleName: config.name,
    CFBundleIdentifier: appId,
    CFBundleShortVersionString: config.version,
    CFBundleVersion: config.buildNumber,
    NGNBundleFile: BUNDLE_FILE,
    NGNModuleName: 'main',
    NGNDistribution: format,
    NGNCapabilities: hostCapabilities(config.options),
    NGNUpdatesURL: config.updatesUrl,
    NGNRuntimeVersion: config.runtimeVersion,
    ...signing,
  };
  const set = Object.entries(all).filter(([, value]) => value !== undefined && value !== null);
  return `${JSON.stringify(Object.fromEntries(set), null, 2)}\n`;
}

/**
 * What a `.deb` depends on: the floor the host is built for, and every other library the host
 * links (the static libcurl's OpenSSL 3, nghttp2 and zlib, SQLite, libatomic and the C++ runtime),
 * under the package names Debian 13 and Ubuntu 24.04 share. dpkg does not read the binary, so a
 * library left out here is missing on a system without it: CI installs only these into a clean
 * Ubuntu 24.04 and checks that every library the built host needs is found
 * (`native/scripts/deb-depends-check.sh`).
 */
export const DEB_DEPENDS = [
  `libc6 (>= ${LINUX_MINIMUMS.glibc})`,
  `libgtk-4-1 (>= ${LINUX_MINIMUMS.gtk})`,
  `libadwaita-1-0 (>= ${LINUX_MINIMUMS.libadwaita})`,
  'libsecret-1-0',
  `libgstreamer1.0-0 (>= ${LINUX_MINIMUMS.gstreamer})`,
  `libgstreamer-plugins-base1.0-0 (>= ${LINUX_MINIMUMS.gstreamer})`,
  'libssl3t64',
  'libnghttp2-14',
  'zlib1g',
  'libsqlite3-0',
  'libatomic1',
  'libstdc++6',
];

/**
 * A `.deb`'s `control` file, depending on `DEB_DEPENDS`.
 *
 * @param {LinuxApp} app
 * @param {{ arch: LinuxArch, installedKiB: number }} build
 */
export function debControl(app, { arch, installedKiB }) {
  const lines = [
    `Package: ${app.packageName}`,
    `Version: ${app.version}`,
    `Architecture: ${LINUX_ARCHES[arch].deb}`,
    `Maintainer: ${app.maintainer}`,
    `Installed-Size: ${installedKiB}`,
    `Depends: ${DEB_DEPENDS.join(', ')}`,
    'Section: misc',
    'Priority: optional',
    ...(app.homepage ? [`Homepage: ${app.homepage}`] : []),
    `Description: ${app.summary}`,
    ` ${app.description.replace(/\r?\n/g, ' ')}`,
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * An rpm spec that copies the prepared folder into `/usr`. rpm's own scanner adds a requirement
 * for each library the binary links; the floor is named on top, under Fedora's and the RHEL
 * family's package names. Nothing is stripped or compiled: the host comes stripped.
 *
 * @param {LinuxApp} app
 * @param {{ tree: string }} build the prepared folder, by its absolute path where rpmbuild runs
 */
export function rpmSpec(app, { tree }) {
  const m = LINUX_MINIMUMS;
  // rpm expands a macro anywhere in the spec, so a literal % is written twice.
  const text = (/** @type {string} */ value) => value.replace(/%/g, '%%');
  const lines = [
    `Name: ${app.packageName}`,
    `Version: ${app.version}`,
    'Release: 1',
    `Summary: ${text(app.summary)}`,
    `License: ${app.license}`,
    ...(app.homepage ? [`URL: ${text(app.homepage)}`] : []),
    ...(app.maintainer ? [`Packager: ${text(app.maintainer)}`] : []),
    `Requires: gtk4 >= ${m.gtk}`,
    `Requires: libadwaita >= ${m.libadwaita}`,
    'Requires: libsecret',
    `Requires: gstreamer1 >= ${m.gstreamer}`,
    `Requires: gstreamer1-plugins-base >= ${m.gstreamer}`,
    // The host is stripped when it is built; rpm's own steps would strip it or look for debug info.
    '%global debug_package %{nil}',
    '%global __os_install_post %{nil}',
    '',
    '%description',
    text(app.description),
    '',
    '%install',
    // The build root is under the project, so its path may have a space: quoted in each command.
    'mkdir -p "$RPM_BUILD_ROOT/usr"',
    `cp -a ${text(shellQuote(`${tree}/.`))} "$RPM_BUILD_ROOT/usr/"`,
    // Read by everyone and written by root, whatever the copy kept: a mount can lose the modes.
    'chmod -R u+rwX,go+rX,go-w "$RPM_BUILD_ROOT/usr"',
    '',
    '%files',
    `/usr/bin/${app.packageName}`,
    `/usr/lib/${app.packageName}`,
    `/usr/share/applications/${app.appId}.desktop`,
    `/usr/share/dbus-1/services/${app.appId}.service`,
    `/usr/share/metainfo/${app.appId}.metainfo.xml`,
    ...(app.icon ? [`/usr/share/icons/hicolor/*/apps/${app.appId}.png`] : []),
  ];
  return `${lines.join('\n')}\n`;
}

/** The top folders a Flatpak's sandbox takes from its runtime, which `--filesystem` cannot give the host's. */
const RESERVED_PATHS = /^\/(?:app|bin|etc|lib|lib32|lib64|sbin|usr)(?:\/|$)/;

/**
 * The Flatpak permissions the app is built with, kept to what it uses: the display, GL and the
 * network (the Expo Updates client and `fetch` need it), the microphone when the app declares a
 * reason for it, and each path its capabilities declare. Files, links, notifications and secrets go
 * through portals, which need no permission.
 *
 * @param {DesktopAppConfig} config
 */
export function finishArgs(config) {
  const args = [
    '--share=ipc',
    '--socket=wayland',
    '--socket=fallback-x11',
    '--device=dri',
    '--share=network',
  ];
  if (config.permissions.usageStrings['NSMicrophoneUsageDescription']) {
    args.push('--socket=pulseaudio');
  }
  for (const entry of config.options.capabilities?.paths ?? []) {
    const access = (entry.access ?? 'read') === 'read' ? ':ro' : '';
    args.push(`--filesystem=${entry.path.replace(/\/$/, '')}${access}`);
  }
  return args;
}

/**
 * What a Flatpak cannot do in its sandbox, one line each, as `sandboxProblems` names for `mas`.
 *
 * @param {DesktopAppConfig} config
 */
export function flatpakProblems(config) {
  const capabilities = config.options.capabilities ?? {};
  const problems = [];
  if ((capabilities.spawn ?? []).length > 0) {
    problems.push(
      'capabilities.spawn: a Flatpak runs programs inside its sandbox, so Processes.spawn reaches only programs in the GNOME runtime or the app, none of the system.',
    );
  }
  if ((capabilities.paths ?? []).length > 0) {
    problems.push(
      'capabilities.paths: each declared path becomes a --filesystem permission, which Flathub reviews; the sandbox reaches no other file but those the user picks.',
    );
    for (const { path: declared } of capabilities.paths ?? []) {
      if (RESERVED_PATHS.test(declared)) {
        problems.push(
          `capabilities.paths: ${declared} is a path a Flatpak's sandbox keeps for its own runtime, so --filesystem does not expose the host's.`,
        );
      }
    }
  }
  return problems;
}

/**
 * The Flatpak manifest: the app's prepared folder for each architecture, as the `.tar.gz` beside
 * it, copied into `/app` with no compile, on the GNOME runtime. `flatpak-builder` builds it, and it
 * is what a Flathub submission starts from.
 *
 * @param {LinuxApp} app
 * @param {{ finishArgs: string[], archives: { arch: LinuxArch, file: string, sha256: string }[] }} build
 */
export function flatpakManifest(app, build) {
  return `${JSON.stringify(
    {
      id: app.appId,
      runtime: FLATPAK_RUNTIME.runtime,
      'runtime-version': FLATPAK_RUNTIME.version,
      sdk: FLATPAK_RUNTIME.sdk,
      command: app.packageName,
      'finish-args': build.finishArgs,
      modules: [
        {
          name: app.packageName,
          buildsystem: 'simple',
          'build-commands': ['cp -a bin lib share /app/'],
          sources: build.archives.map(({ arch, file, sha256 }) => ({
            type: 'archive',
            path: file,
            sha256,
            'only-arches': [LINUX_ARCHES[arch].flatpak],
          })),
        },
      ],
    },
    null,
    2,
  )}\n`;
}

/**
 * The prepared folder's files as archive entries under `prefix`, folders first.
 *
 * @param {System} sys
 * @param {string} tree
 * @param {string} prefix
 * @returns {ArchiveEntry[]}
 */
function treeEntries(sys, tree, prefix) {
  /** @type {ArchiveEntry[]} */
  const entries = sys
    .files(tree)
    .map(
      (/** @type {{ path: string, mode: number, link?: string }} */ { path: file, mode, link }) =>
        link !== undefined
          ? { path: `${prefix}${file}`, mode: 0o777, link }
          : { path: `${prefix}${file}`, mode, data: sys.readBytes(path.join(tree, file)) },
    );
  return withFolders(entries);
}

/**
 * @param {{ status: number }} result
 * @param {string} message
 */
function expectSuccess(result, message) {
  if (result.status !== 0) throw new Error(message);
}

/** @param {string} text */
function shellQuote(text) {
  return `'${text.replace(/'/g, "'\\''")}'`;
}

/**
 * Where `rpmbuild` and `flatpak-builder` run: on this machine when it is Linux and has the tool,
 * else in a container through Docker or Podman (`PACKAGING_IMAGES`). Throws, naming what is
 * missing, before anything is built.
 *
 * @param {System} sys
 * @param {'rpmbuild' | 'flatpak-builder'} tool
 * @param {LinuxFormat} format
 * @returns {{ native: true } | { native: false, engine: string }}
 */
export function linuxToolRunner(sys, tool, format) {
  /** @param {string} command @param {string[]} args */
  const works = (command, args) => {
    try {
      return sys.run(command, args, { capture: true }).status === 0;
    } catch {
      return false;
    }
  };
  if (sys.platform === 'linux' && works(tool, ['--version'])) return { native: true };
  for (const engine of ['docker', 'podman']) {
    if (works(engine, ['info'])) return { native: false, engine };
  }
  const where = sys.platform === 'linux' ? `${tool}, or Docker or Podman` : 'Docker or Podman';
  throw new UsageError(
    `--format ${format} runs ${tool}, and this machine has no ${where} running to run it in a ` +
      'container. Install one and start it, then package again.',
  );
}

/**
 * The images the tools run in where this machine lacks them. rpmbuild runs on AlmaLinux 9, whose
 * rpm is the oldest the packages install with, so every newer one reads what it writes.
 * flatpak-builder runs on Fedora 44: AlmaLinux 9's 1.2 composes the metainfo with
 * `appstream-compose`, which the GNOME runtime's SDK no longer has.
 */
export const PACKAGING_IMAGES = {
  rpmbuild: {
    name: 'ngn-package-rpm',
    dockerfile: `FROM almalinux:9
RUN dnf -y install rpm-build rpm-sign gnupg2 tar gzip && dnf clean all
`,
  },
  'flatpak-builder': {
    name: 'ngn-package-flatpak',
    dockerfile: `FROM fedora:44
RUN dnf -y install flatpak flatpak-builder gnupg2 && dnf clean all
`,
  },
};

/**
 * Runs `script` (a shell script on disk) in the tool's packaging image, built first when this
 * machine does not have it. The folders it touches are mounted at their own paths, and the GPG
 * home, when a key signs, read-only at `/gnupg`. flatpak-builder's sandbox needs the container
 * privileged, and the GNOME runtime it installs is kept in a volume between packages.
 *
 * @param {System} sys
 * @param {string} engine
 * @param {{ tool: 'rpmbuild' | 'flatpak-builder', script: string, folders: string[], staging: string, gnupg?: string }} run
 */
function inContainer(sys, engine, { tool, script, folders, staging, gnupg }) {
  const image = PACKAGING_IMAGES[tool];
  const tag = `${image.name}:${createHash('sha256').update(image.dockerfile).digest('hex').slice(0, 12)}`;
  if (sys.run(engine, ['image', 'inspect', tag], { capture: true }).status !== 0) {
    const context = path.join(staging, 'image');
    sys.writeFile(path.join(context, 'Dockerfile'), image.dockerfile);
    expectSuccess(
      sys.run(engine, ['build', '-t', tag, context]),
      `${engine} could not build the packaging image; the output above says why.`,
    );
  }
  const flatpak = tool === 'flatpak-builder';
  const mounts = [...new Set(folders)].flatMap((folder) => ['-v', `${folder}:${folder}`]);
  return sys.run(engine, [
    'run',
    '--rm',
    ...(flatpak ? ['--privileged'] : []),
    ...mounts,
    ...(gnupg ? ['-v', `${gnupg}:/gnupg:ro`] : []),
    ...(flatpak ? ['-v', 'ngn-package-flatpak:/root/.local/share/flatpak'] : []),
    tag,
    'sh',
    script,
  ]);
}

/**
 * The lines that set up GPG for a script: in a container, a copy of the mounted home (gpg writes
 * to its home), so the key must need no passphrase there; on Linux, the user's own.
 *
 * @param {boolean} native
 */
function gpgSetup(native) {
  if (native) return [];
  return [
    'rm -rf /tmp/gnupg && cp -r /gnupg /tmp/gnupg && chmod 700 /tmp/gnupg',
    'export GNUPGHOME=/tmp/gnupg',
  ];
}

/**
 * The shell function `ngn_restore`, which gives what a container wrote back to this user: Docker on
 * Linux writes as root. Rootless Podman needs none, since container root is already this user, and
 * a host UID given to `chown` there would be read as a container one. Scripts run it on exit, so a
 * failed build leaves nothing this user cannot remove, and it never changes the exit status.
 *
 * @param {System} sys
 * @param {ReturnType<typeof linuxToolRunner>} runner
 * @param {string[]} paths
 * @returns {string[]}
 */
function restoreOwnerLines(sys, runner, paths) {
  const rootless = !runner.native && runner.engine === 'podman';
  if (
    runner.native ||
    rootless ||
    sys.platform !== 'linux' ||
    typeof process.getuid !== 'function'
  ) {
    return [];
  }
  const owner = `${process.getuid()}:${process.getgid?.() ?? process.getuid()}`;
  return [
    `ngn_restore() { chown -R ${owner} ${paths.map(shellQuote).join(' ')} 2>/dev/null || true; }`,
  ];
}

/**
 * The GPG key packages are signed with, from `NGN_GPG_KEY`, and the home it is in.
 *
 * @param {System} sys
 */
function gpgKey(sys) {
  const key = sys.env['NGN_GPG_KEY'];
  if (!key) return null;
  return { key, home: sys.env['GNUPGHOME'] || path.join(homedir(), '.gnupg') };
}

/**
 * The architectures `--arch` asks for.
 *
 * @param {LinuxArch | 'all'} arch
 * @returns {LinuxArch[]}
 */
export function linuxArches(arch) {
  return arch === 'all' ? ['x64', 'arm64'] : [arch];
}

/**
 * Builds the app for Linux and makes the packages `options.format` asks for, one per architecture.
 * Returns the exit status.
 *
 * @param {LinuxPackageCommand} options
 * @param {System} sys
 */
export async function packageLinux(options, sys) {
  if (sys.platform !== 'linux' && sys.platform !== 'darwin') {
    throw new UsageError('Packaging for Linux runs on Linux or macOS.');
  }
  const plan = planLinuxPackage(options, sys);
  const built = buildLinuxBundle(sys, plan);
  const { format } = options;
  /** @type {string[]} */
  const made = [];
  /** @type {{ arch: LinuxArch, file: string, sha256: string }[]} */
  const archives = [];
  for (const { arch, buildDir } of plan.hosts) {
    const tree = assembleTree(sys, plan, built, { arch, buildDir });
    made.push(...packageTree(sys, plan, { arch, tree, archives }));
  }
  if (format === 'flatpak' && plan.runner) {
    made.push(...buildFlatpak(sys, { ...plan, runner: plan.runner, archives }));
  }
  for (const file of made) console.log(path.relative(plan.cwd, file));
  return 0;
}

/**
 * The package of one architecture's tree in `plan.format`; for `app` and `flatpak` its `.tar.gz`
 * too, which is added to `archives`. Returns the files made.
 *
 * @param {System} sys
 * @param {LinuxPlan} plan
 * @param {{ arch: LinuxArch, tree: string, archives: { arch: LinuxArch, file: string, sha256: string }[] }} built
 * @returns {string[]}
 */
function packageTree(sys, plan, { arch, tree, archives }) {
  const { format, app } = plan;
  if (format === 'deb') return [writeDeb(sys, plan, { arch, tree })];
  if (format === 'rpm') {
    return plan.runner ? [buildRpm(sys, { ...plan, runner: plan.runner, arch, tree })] : [];
  }
  const base = `${app.packageName}-${app.version}-${LINUX_ARCHES[arch].rpm}`;
  const archive = path.join(format === 'app' ? plan.output : plan.staging, `${base}.tar.gz`);
  sys.writeFile(archive, tarGz(treeEntries(sys, tree, `${base}/`)));
  archives.push({ arch, file: archive, sha256: sys.sha256(archive) });
  return format === 'app' ? shipFolder(sys, plan, { tree, archive, base }) : [];
}

/**
 * @typedef {{ cwd: string, expo: ExpoConfig, config: DesktopAppConfig, app: LinuxApp, format: LinuxFormat, hosts: { arch: LinuxArch, buildDir: string }[], hermesc: string, icons: { size: number, png: Buffer }[], runner: ReturnType<typeof linuxToolRunner> | null, signing: ReturnType<typeof gpgKey>, output: string, staging: string }} LinuxPlan
 */

/**
 * Everything checked before anything is built, then the host for each architecture and the
 * `hermesc` that compiles the bundle.
 *
 * @param {LinuxPackageCommand} options
 * @param {System} sys
 * @returns {LinuxPlan}
 */
function planLinuxPackage(options, sys) {
  const { format } = options;
  const cwd = sys.cwd();
  const reactNative = resolveReactNative(sys, cwd);
  const expo = readExpoConfig(sys, cwd, 'linux');
  const config = desktopAppConfig(expo);
  const names = linuxNames(expo, config, format);
  const description = expo.description?.trim();
  if (!description) {
    throw new UsageError(
      'A Linux package states what the app does, and app.json has no expo.description. Add one: ' +
        'its first sentence is the summary software centres list.',
    );
  }
  const tool = format === 'rpm' ? 'rpmbuild' : format === 'flatpak' ? 'flatpak-builder' : null;
  const runner = tool ? linuxToolRunner(sys, tool, format) : null;
  const signing = gpgKey(sys);
  if (signing && format === 'app') checkGpg(sys);
  if (format === 'flatpak') for (const line of flatpakProblems(config)) sys.warn(line);
  const icons = expo.icon ? scaledIcons(sys, path.resolve(cwd, expo.icon)) : [];

  const hosts = linuxArches(options.arch).map((arch) => ({
    arch,
    buildDir: prepareHost(sys, { os: 'linux', arch, release: true, universal: false, expo })
      .buildDir,
  }));
  const app = {
    ...names,
    name: config.name,
    summary: summaryOf(description),
    description,
    categories: categoryList(options.categories),
    schemes: config.schemes,
    mimeTypes: [
      ...new Set((config.options.documentTypes ?? []).flatMap((type) => type.mimeTypes ?? [])),
    ],
    icon: icons.length > 0,
    // The day it is packaged, which AppStream asks of a release.
    released: new Date().toISOString().slice(0, 10),
    license: options.license,
    homepage: options.homepage,
    maintainer: options.maintainer,
  };
  return {
    cwd,
    expo,
    config,
    app,
    format,
    hosts,
    hermesc: linuxHermesCompiler(sys, { reactNative, hosts, expo }),
    icons,
    runner,
    signing,
    output: path.resolve(cwd, options.output),
    staging: path.join(cwd, '.expo', 'ng-native-desktop', 'package-linux'),
  };
}

/**
 * What is the same for every architecture: the bundle compiled to Hermes bytecode once, its assets
 * and the updates certificate.
 *
 * @param {System} sys
 * @param {LinuxPlan} plan
 */
function buildLinuxBundle(sys, { cwd, config, hermesc, staging }) {
  sys.remove(staging);
  const assets = path.join(staging, 'bundle');
  const javascript = path.join(staging, 'main.js');
  const bytecode = path.join(staging, BUNDLE_FILE);
  expectSuccess(
    sys.expo(cwd, [
      'export:embed',
      '--platform',
      'linux',
      '--dev',
      'false',
      '--bundle-output',
      javascript,
      '--assets-dest',
      assets,
    ]),
    'expo export:embed did not bundle the app for linux; the output above says why.',
  );
  expectSuccess(
    sys.run(hermesc, [
      '-emit-binary',
      '-O',
      '-w',
      '-max-diagnostic-width=80',
      '-out',
      bytecode,
      javascript,
    ]),
    'hermesc could not compile the bundle to Hermes bytecode; the output above says why.',
  );
  const certificate = config.updatesCodeSigning
    ? sys.readFile(path.resolve(cwd, config.updatesCodeSigning.certificate))
    : undefined;
  return { assets, bytecode, certificate };
}

/**
 * The installed tree for one architecture, as a prefix lays it out: `bin/<name>` linking to the
 * host in `lib/<name>/` beside the bundle, its assets and `metadata.json`, and in `share/` the
 * desktop entry, the metainfo and the icons. Returns its folder.
 *
 * @param {System} sys
 * @param {LinuxPlan} plan
 * @param {ReturnType<typeof buildLinuxBundle>} built
 * @param {{ arch: LinuxArch, buildDir: string }} host
 */
function assembleTree(sys, { config, app, format, staging, icons }, built, { arch, buildDir }) {
  const tree = path.join(staging, arch, 'tree');
  const lib = path.join(tree, 'lib', app.packageName);
  // The assets, where React Native's resolver looks beside the bundle; an app may have none.
  if (sys.exists(built.assets)) sys.copy(built.assets, lib);
  sys.copy(built.bytecode, path.join(lib, BUNDLE_FILE));
  sys.copy(path.join(buildDir, 'gtk', 'ngn-linux'), path.join(lib, HOST_FILE));
  sys.symlink(
    path.join('..', 'lib', app.packageName, HOST_FILE),
    path.join(tree, 'bin', app.packageName),
  );
  sys.writeFile(
    path.join(lib, 'metadata.json'),
    linuxMetadata(config, { format, appId: app.appId, updatesCertificate: built.certificate }),
  );
  const share = path.join(tree, 'share');
  const prefix = LINUX_PREFIX[format];
  sys.writeFile(
    path.join(share, 'applications', `${app.appId}.desktop`),
    desktopEntry(app, { dbusActivatable: prefix !== undefined }),
  );
  if (prefix !== undefined) {
    sys.writeFile(
      path.join(share, 'dbus-1', 'services', `${app.appId}.service`),
      dbusService(app, prefix),
    );
  }
  sys.writeFile(path.join(share, 'metainfo', `${app.appId}.metainfo.xml`), metainfo(app));
  for (const { size, png } of icons) {
    sys.writeFile(
      path.join(share, 'icons', 'hicolor', `${size}x${size}`, 'apps', `${app.appId}.png`),
      png,
    );
  }
  return tree;
}

/**
 * The `app` format: the tree as a runnable folder beside its `.tar.gz`, which is signed when a key
 * is set.
 *
 * @param {System} sys
 * @param {LinuxPlan} plan
 * @param {{ tree: string, archive: string, base: string }} built
 */
function shipFolder(sys, { output, signing }, { tree, archive, base }) {
  const folder = path.join(output, base);
  sys.remove(folder);
  sys.copy(tree, folder);
  // An earlier signed build's signature does not belong to this archive.
  if (!signing) sys.remove(`${archive}.asc`);
  return signing ? [folder, archive, signDetached(sys, signing.key, archive)] : [folder, archive];
}

/**
 * The `.deb` of one architecture's tree, installed into `/usr`.
 *
 * @param {System} sys
 * @param {LinuxPlan} plan
 * @param {{ arch: LinuxArch, tree: string }} built
 */
function writeDeb(sys, { app, output }, { arch, tree }) {
  const deb = path.join(output, `${app.packageName}_${app.version}_${LINUX_ARCHES[arch].deb}.deb`);
  const data = treeEntries(sys, tree, './usr/');
  const bytes = data.reduce((sum, entry) => sum + (entry.data?.length ?? 0), 0);
  const control = debControl(app, { arch, installedKiB: Math.ceil(bytes / 1024) });
  sys.writeFile(
    deb,
    ar([
      { name: 'debian-binary', data: Buffer.from('2.0\n') },
      {
        name: 'control.tar.gz',
        data: tarGz([
          { path: './', mode: 0o755 },
          { path: './control', mode: 0o644, data: Buffer.from(control) },
        ]),
      },
      { name: 'data.tar.gz', data: tarGz(data) },
    ]),
  );
  return deb;
}

/**
 * The first sentence of the description, without its full stop, as AppStream wants a summary.
 *
 * @param {string} description
 */
export function summaryOf(description) {
  const first = description.split(/(?<=[.!?])\s/)[0] ?? description;
  return first.replace(/\s+/g, ' ').replace(/\.$/, '').trim();
}

/**
 * The icon scaled to each hicolor size up to its own, as PNGs. Throws a usage error for an icon it
 * cannot read or that is not square.
 *
 * @param {System} sys
 * @param {string} icon
 */
export function scaledIcons(sys, icon) {
  let image;
  try {
    image = decodePng(sys.readBytes(icon));
  } catch (error) {
    throw new UsageError(
      `The icon ${icon} cannot be scaled for Linux: ${error instanceof Error ? error.message : error}. ` +
        'expo.icon should be a square PNG, 1024 pixels a side.',
    );
  }
  if (image.width !== image.height) {
    throw new UsageError(
      `The icon ${icon} is ${image.width} by ${image.height}; Linux icons are square. Make expo.icon square.`,
    );
  }
  return ICON_SIZES.filter((size) => size <= image.width).map((size) => ({
    size,
    png: encodePng(scaleImage(image, size)),
  }));
}

/**
 * Stops before anything is built when `NGN_GPG_KEY` is set and there is no `gpg` to sign with.
 *
 * @param {System} sys
 */
function checkGpg(sys) {
  let found = false;
  try {
    found = sys.run('gpg', ['--version'], { capture: true }).status === 0;
  } catch {
    found = false;
  }
  if (!found) {
    throw new UsageError('NGN_GPG_KEY asks for a signature, and gpg is not installed to make it.');
  }
}

/**
 * A detached, armoured signature of `file` beside it, by `key`.
 *
 * @param {System} sys
 * @param {string} key
 * @param {string} file
 */
function signDetached(sys, key, file) {
  const signature = `${file}.asc`;
  sys.remove(signature);
  expectSuccess(
    sys.run('gpg', [
      '--batch',
      '--yes',
      '--armor',
      '--local-user',
      key,
      '--detach-sign',
      '--output',
      signature,
      file,
    ]),
    `gpg could not sign ${path.basename(file)} with ${key}.`,
  );
  return signature;
}

/**
 * Builds the rpm for one architecture with `rpmbuild --target`, which copies prebuilt files for any
 * architecture without emulation, and signs it with `rpmsign` when a key is set.
 *
 * @param {System} sys
 * @param {{ app: LinuxApp, arch: LinuxArch, tree: string, staging: string, output: string, runner: ReturnType<typeof linuxToolRunner>, signing: ReturnType<typeof gpgKey> }} build
 */
function buildRpm(sys, { app, arch, tree, staging, output, runner, signing }) {
  const top = path.join(staging, arch, 'rpm');
  const spec = path.join(staging, arch, `${app.packageName}.spec`);
  sys.writeFile(spec, rpmSpec(app, { tree }));
  const target = LINUX_ARCHES[arch].rpm;
  const file = `${app.packageName}-${app.version}-1.${target}.rpm`;
  const built = path.join(top, 'RPMS', target, file);
  const rpm = path.join(output, file);
  const restore = restoreOwnerLines(sys, runner, [top, rpm]);
  const lines = [
    'set -e',
    ...restore,
    ...(restore.length > 0 ? ['trap ngn_restore EXIT'] : []),
    `rpmbuild -bb --target ${target} --define ${shellQuote(`_topdir ${top}`)} ${shellQuote(spec)}`,
    ...(signing
      ? [
          ...gpgSetup(runner.native),
          `rpmsign --addsign --define ${shellQuote(`_gpg_name ${signing.key}`)} ${shellQuote(built)}`,
        ]
      : []),
    `mkdir -p ${shellQuote(output)}`,
    `cp ${shellQuote(built)} ${shellQuote(rpm)}`,
  ];
  runScript(sys, runner, {
    lines,
    staging,
    output,
    signing,
    tool: 'rpmbuild',
    name: `rpm-${arch}`,
  });
  return rpm;
}

/**
 * Builds the Flatpak for each architecture with `flatpak-builder` into one OSTree repository, the
 * app's own remote, signed when a key is set, then a `.flatpak` bundle of each that installs the
 * GNOME runtime from Flathub. An architecture other than the machine's needs QEMU's binfmt handlers,
 * since the build runs in that architecture's SDK.
 *
 * @param {System} sys
 * @param {{ app: LinuxApp, config: DesktopAppConfig, archives: { arch: LinuxArch, file: string, sha256: string }[], staging: string, output: string, runner: ReturnType<typeof linuxToolRunner>, signing: ReturnType<typeof gpgKey> }} build
 */
function buildFlatpak(sys, { app, config, archives, staging, output, runner, signing }) {
  // The manifest's archives sit beside it, so it builds again from the output folder.
  const placed = archives.map((archive) => {
    const file = path.join(output, path.basename(archive.file));
    sys.copy(archive.file, file);
    return { ...archive, file: path.basename(file) };
  });
  const manifest = path.join(output, `${app.appId}.json`);
  sys.writeFile(
    manifest,
    flatpakManifest(app, { finishArgs: finishArgs(config), archives: placed }),
  );
  const repo = path.join(output, 'flatpak-repo');
  const sign = signing ? ` --gpg-sign=${shellQuote(signing.key)}` : '';
  const flathub = 'https://dl.flathub.org/repo/flathub.flatpakrepo';
  const bundles = placed.map(({ arch }) =>
    path.join(output, `${app.packageName}-${app.version}-${LINUX_ARCHES[arch].flatpak}.flatpak`),
  );
  const restore = restoreOwnerLines(sys, runner, [repo, ...bundles]);
  const lines = [
    'set -e',
    ...restore,
    ...(signing ? gpgSetup(runner.native) : []),
    `flatpak remote-add --user --if-not-exists flathub ${flathub}`,
    // flatpak-builder's own folders on the machine's disk, not a mount, which cannot always take
    // the links it makes.
    'work="$(mktemp -d)"',
    `trap 'rm -rf "$work" 2>/dev/null || true${restore.length > 0 ? '; ngn_restore' : ''}' EXIT`,
    ...placed.flatMap(({ arch }, index) => {
      const target = LINUX_ARCHES[arch].flatpak;
      return [
        `flatpak-builder --user --arch=${target} --install-deps-from=flathub --force-clean --disable-rofiles-fuse ` +
          `--default-branch=stable --state-dir="$work/state" --repo=${shellQuote(repo)}${sign} ` +
          `"$work/${target}" ${shellQuote(manifest)}`,
        `flatpak build-bundle --arch=${target} --runtime-repo=${flathub} ${shellQuote(repo)} ` +
          `${shellQuote(bundles[index] ?? '')} ${shellQuote(app.appId)} stable`,
      ];
    }),
    `flatpak build-update-repo --generate-static-deltas${sign} ${shellQuote(repo)}`,
  ];
  runScript(sys, runner, {
    lines,
    staging,
    output,
    signing,
    tool: 'flatpak-builder',
    name: 'flatpak',
  });
  return [...placed.map(({ file }) => path.join(output, file)), manifest, repo, ...bundles];
}

/**
 * Writes `lines` as a script in the staging folder and runs it here or in the container.
 *
 * @param {System} sys
 * @param {ReturnType<typeof linuxToolRunner>} runner
 * @param {{ lines: string[], staging: string, output: string, signing: ReturnType<typeof gpgKey>, tool: 'rpmbuild' | 'flatpak-builder', name: string }} run
 */
function runScript(sys, runner, { lines, staging, output, signing, tool, name }) {
  const script = path.join(staging, `${name}.sh`);
  sys.writeFile(script, `${lines.join('\n')}\n`);
  // The container mounts the output folder, which an engine will not make (Podman) or will make as
  // root (a rootful Docker).
  sys.mkdir(output);
  const result = runner.native
    ? sys.run('sh', [script])
    : inContainer(sys, runner.engine, {
        tool,
        script,
        folders: [staging, output],
        staging,
        ...(signing && { gnupg: signing.home }),
      });
  expectSuccess(result, `${tool} did not make the package; the output above says why.`);
}
