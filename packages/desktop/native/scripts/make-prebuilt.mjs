#!/usr/bin/env node
/**
 * Builds the prebuilt desktop host for one React Native version and packs it for a release.
 *
 *   make-prebuilt.mjs <app> <out> [--version <v>] [--base-url <url>] [--manifest <prebuilt.json>]
 *
 * - <app>: the app whose react-native and host libraries (react-native-screens,
 *   react-native-safe-area-context) the host is built against: the desktop template.
 * - <out>: where the archive and `prebuilt-host.json`, its manifest entry, go.
 * - --version: the release the archive is named for (default: this package's version), which the
 *   release workflow knows before it writes the version into package.json.
 * - --base-url: where the release serves the archive; its URL is this and the archive's name.
 * - --manifest: a `prebuilt.json` to write the entry into, in place of the one for the same React
 *   Native version.
 *
 * The host is the universal Release build (`build.sh --universal --release`), with no app's
 * linked code. `ngn-macos` and `hermesc` have their local symbols stripped and are signed with the hardened runtime by
 * `NGN_SIGN_IDENTITY`, and ad hoc when it is not set, as in a dry run. Nothing is uploaded.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { HOST_LIBRARIES, packageDir } from '../../bin/host.mjs';
import { prebuiltName, readManifest, withHost } from '../../bin/prebuilt.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @param {string} command @param {string[]} args @param {import('node:child_process').SpawnSyncOptions} [options] */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}).`);
  return result;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    version: { type: 'string' },
    'base-url': { type: 'string' },
    manifest: { type: 'string' },
  },
});
const [appArg, outArg] = positionals;
if (!appArg || !outArg) {
  console.error(
    'Usage: make-prebuilt.mjs <app> <out> [--base-url <url>] [--manifest <prebuilt.json>]',
  );
  process.exit(2);
}
const app = path.resolve(appArg);
const out = path.resolve(outArg);
const require = createRequire(path.join(app, 'package.json'));
/** @param {string} name */
const installed = (name) => {
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
};
/** @param {string} dir */
const versionOf = (dir) =>
  String(JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version);

const reactNativeDir = installed('react-native');
if (!reactNativeDir) throw new Error(`react-native is not installed in ${app}.`);
const reactNative = versionOf(reactNativeDir);
const libraries = Object.fromEntries(
  HOST_LIBRARIES.flatMap((name) => {
    const dir = installed(name);
    return dir ? [[name, dir]] : [];
  }),
);

const build = run(
  path.join(here, 'build.sh'),
  [
    reactNativeDir,
    '--universal',
    '--release',
    ...Object.values(libraries).flatMap((dir) => ['--library', dir]),
  ],
  { stdio: ['inherit', 'pipe', 'inherit'], env: { ...process.env, NGN_DESKTOP_LINK: '' } },
);
const buildDir = build.stdout.trim().split('\n').pop() ?? '';

const staging = mkdtempSync(path.join(tmpdir(), 'ngn-prebuilt-'));
try {
  const appkit = path.join(staging, 'appkit');
  mkdirSync(appkit, { recursive: true });
  for (const name of ['ngn-macos', 'hermesc', 'Sparkle.framework']) {
    cpSync(path.join(buildDir, 'appkit', name), path.join(appkit, name), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
  const identity = process.env['NGN_SIGN_IDENTITY'] || '-';
  for (const name of ['ngn-macos', 'hermesc']) {
    // Local symbols only, as package strips them; before signing, which stripping would break.
    run('strip', ['-x', path.join(appkit, name)]);
    run('codesign', [
      '--force',
      '--options',
      'runtime',
      identity === '-' ? '--timestamp=none' : '--timestamp',
      '--sign',
      identity,
      path.join(appkit, name),
    ]);
  }
  const archs = run('lipo', ['-archs', path.join(appkit, 'ngn-macos')], {
    stdio: ['inherit', 'pipe', 'inherit'],
  }).stdout.trim();
  if (archs.split(' ').sort().join(' ') !== 'arm64 x86_64') {
    throw new Error(`ngn-macos is built for ${archs}, not arm64 and x86_64.`);
  }

  const desktopVersion = values.version ?? versionOf(packageDir);
  const name = prebuiltName(desktopVersion, reactNative);
  mkdirSync(out, { recursive: true });
  const archive = path.join(out, name);
  // Owner and group dropped, so the archive does not carry the build machine's.
  run('tar', ['-czf', archive, '--uid', '0', '--gid', '0', '-C', staging, 'appkit']);
  const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
  const host = {
    reactNative,
    url: `${(values['base-url'] ?? '').replace(/\/$/, '')}/${name}`,
    sha256,
    libraries: Object.fromEntries(
      Object.entries(libraries).map(([lib, dir]) => [lib, versionOf(dir)]),
    ),
  };
  writeFileSync(path.join(out, 'prebuilt-host.json'), `${JSON.stringify(host, null, 2)}\n`);
  if (values.manifest) {
    const file = path.resolve(values.manifest);
    const manifest = withHost(readManifest(readFileSync(file, 'utf8')), host);
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  console.log(`${archive}\n${JSON.stringify(host, null, 2)}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
