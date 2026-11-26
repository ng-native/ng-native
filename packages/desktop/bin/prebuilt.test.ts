import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { system } from './host.mjs';
import {
  choosePrebuilt,
  entryName,
  findHost,
  fetchPrebuilt,
  HOST_REACT_NATIVE,
  prebuiltName,
  readManifest,
  RELEASE_HOSTS,
  signPrebuiltFiles,
  withHost,
  withReleaseHosts,
  type PrebuiltHost,
} from './prebuilt.mjs';

const SHA = 'a'.repeat(64);
const HOST: PrebuiltHost = {
  reactNative: '0.88.0',
  url: 'https://example.com/host.tar.gz',
  sha256: SHA,
  libraries: { 'react-native-screens': '4.20.0', 'react-native-safe-area-context': '5.10.1' },
};
const DEBUG: PrebuiltHost = {
  ...HOST,
  flavour: 'debug',
  url: 'https://example.com/host-debug.tar.gz',
  sha256: 'd'.repeat(64),
};
const MANIFEST = { version: 1, hosts: [HOST] };
const APP = {
  reactNative: '0.88.0',
  flavour: 'release' as const,
  linked: 0,
  libraries: { 'react-native-screens': null, 'react-native-safe-area-context': '5.10.1' },
  deny: [],
  env: {},
};

describe('the prebuilt manifest', () => {
  it('names an archive by the release and the React Native version', () => {
    assert.equal(
      prebuiltName('0.23.0', '0.88.0'),
      'ng-native-desktop-host-0.23.0-rn-0.88.0-macos-universal.tar.gz',
    );
    assert.equal(
      prebuiltName('0.23.0', '0.88.0', 'release'),
      'ng-native-desktop-host-0.23.0-rn-0.88.0-macos-universal.tar.gz',
    );
    assert.equal(
      prebuiltName('0.23.0', '0.88.0', 'debug'),
      'ng-native-desktop-host-0.23.0-rn-0.88.0-macos-universal-debug.tar.gz',
    );
  });

  it("names each version and flavour's entry file apart, so every build can share a folder", () => {
    assert.equal(
      entryName({ reactNative: '0.88.0', flavour: 'debug' }),
      'prebuilt-host-rn-0.88.0-debug.json',
    );
    assert.equal(
      entryName({ reactNative: '0.88.0', flavour: 'release' }),
      'prebuilt-host-rn-0.88.0-release.json',
    );
    assert.equal(
      entryName({ reactNative: '0.88.1', flavour: 'debug' }),
      'prebuilt-host-rn-0.88.1-debug.json',
    );
  });

  it('builds hosts for every React Native version a new app or desktop app is given', () => {
    // An app on a version with no prebuilt host builds its own from source, and a Linux host only
    // on Linux, so each template's version needs one.
    for (const template of ['template', 'template-desktop']) {
      const manifest = JSON.parse(
        readFileSync(new URL(`../../../${template}/package.json`, import.meta.url), 'utf8'),
      );
      assert.ok(
        HOST_REACT_NATIVE.includes(manifest.dependencies['react-native']),
        `${template} is on react-native ${manifest.dependencies['react-native']}`,
      );
    }
    // Each workflow that builds hosts builds one for each version, and the release no other.
    for (const workflow of ['release', 'desktop']) {
      const text = readFileSync(
        new URL(`../../../.github/workflows/${workflow}.yml`, import.meta.url),
        'utf8',
      );
      const matrices = [...text.matchAll(/^ +react-native: (\[.*\])$/gm)];
      assert.equal(matrices.length, 2, `${workflow}.yml's host matrices`);
      for (const [, list] of matrices) {
        assert.deepEqual(JSON.parse(list.replaceAll("'", '"')), HOST_REACT_NATIVE, workflow);
      }
    }
    // And fetch.sh pins each one's sources, or its build stops there.
    const fetch = readFileSync(new URL('../native/scripts/fetch.sh', import.meta.url), 'utf8');
    for (const version of HOST_REACT_NATIVE) {
      assert.match(fetch, new RegExp(`^  ${version.replaceAll('.', '\\.')}\\)$`, 'm'), version);
    }
  });

  it('names a Linux archive and entry by its architecture, apart from the macOS ones', () => {
    assert.equal(
      prebuiltName('0.23.0', '0.88.0', 'release', { os: 'linux', arch: 'arm64' }),
      'ng-native-desktop-host-0.23.0-rn-0.88.0-linux-arm64.tar.gz',
    );
    assert.equal(
      prebuiltName('0.23.0', '0.88.0', 'debug', { os: 'linux', arch: 'x64' }),
      'ng-native-desktop-host-0.23.0-rn-0.88.0-linux-x64-debug.tar.gz',
    );
    assert.equal(
      entryName({ reactNative: '0.88.0', flavour: 'debug', os: 'linux', arch: 'x64' }),
      'prebuilt-host-rn-0.88.0-linux-x64-debug.json',
    );
    assert.equal(
      entryName({ reactNative: '0.88.0', flavour: 'release', os: 'macos' }),
      'prebuilt-host-rn-0.88.0-release.json',
    );
    assert.throws(
      () => entryName({ reactNative: '0.88.0', flavour: 'debug', os: 'linux' }),
      /x64 or arm64/,
    );
    // Every host a release publishes has an entry file of its own: both flavours for macOS and
    // Linux on two architectures, for each React Native version.
    const names = RELEASE_HOSTS.map(entryName);
    assert.equal(new Set(names).size, 6 * HOST_REACT_NATIVE.length);
    assert.deepEqual(
      [...new Set(RELEASE_HOSTS.map((slot) => slot.reactNative))],
      HOST_REACT_NATIVE,
    );
  });

  it('puts every release host’s entry in the manifest, and stops on one missing or mislabelled', () => {
    const entries: Record<string, object> = Object.fromEntries(
      RELEASE_HOSTS.map((slot) => [
        entryName(slot),
        {
          ...HOST,
          reactNative: slot.reactNative,
          flavour: slot.flavour,
          ...(slot.os === 'linux' && { os: slot.os, arch: slot.arch }),
          url: entryName(slot),
        },
      ]),
    );
    const read = (name: string) => {
      if (!(name in entries)) throw new Error(`ENOENT ${name}`);
      return JSON.stringify(entries[name]);
    };
    const manifest = withReleaseHosts({ version: 1, hosts: [] }, read);
    assert.equal(manifest.hosts.length, 6 * HOST_REACT_NATIVE.length);
    for (const reactNative of HOST_REACT_NATIVE) {
      assert.equal(
        findHost(manifest, { reactNative, flavour: 'debug', os: 'linux', arch: 'arm64' })?.url,
        `prebuilt-host-rn-${reactNative}-linux-arm64-debug.json`,
      );
      // A Linux host never answers for the macOS one.
      assert.equal(
        findHost(manifest, { reactNative, flavour: 'debug' })?.url,
        `prebuilt-host-rn-${reactNative}-debug.json`,
      );
    }
    const name = 'prebuilt-host-rn-0.88.1-linux-arm64-release.json';
    const entry = entries[name];
    delete entries[name];
    assert.throws(
      () => withReleaseHosts({ version: 1, hosts: [] }, read),
      /ENOENT prebuilt-host-rn-0.88.1-linux-arm64-release/,
    );
    entries[name] = { ...entry, arch: 'x64' };
    assert.throws(
      () => withReleaseHosts({ version: 1, hosts: [] }, read),
      /prebuilt-host-rn-0.88.1-linux-arm64-release.json is not the React Native 0.88.1 linux-arm64 release host/,
    );
    // A host built against another React Native is not this slot's either.
    entries[name] = { ...entry, reactNative: '0.88.0' };
    assert.throws(
      () => withReleaseHosts({ version: 1, hosts: [] }, read),
      /is not the React Native 0.88.1 linux-arm64 release host/,
    );
  });

  it('reads a manifest, and anything else as none', () => {
    assert.deepEqual(readManifest(JSON.stringify(MANIFEST)), MANIFEST);
    for (const text of ['', '{', '{"version":2,"hosts":[]}', '{"version":1}']) {
      assert.deepEqual(readManifest(text), { version: 1, hosts: [] });
    }
  });

  it('reads both flavours of a React Native version', () => {
    const release = { ...HOST, flavour: 'release' as const };
    const both = { version: 1, hosts: [DEBUG, release] };
    assert.deepEqual(readManifest(JSON.stringify(both)), both);
  });

  it('keeps one host per React Native version and flavour', () => {
    const newer = { ...HOST, sha256: 'b'.repeat(64) };
    const other = { ...HOST, reactNative: '0.89.0' };
    assert.deepEqual(withHost(withHost(MANIFEST, other), newer).hosts, [other, newer]);

    // The debug host goes in beside the release one, and replaces only the debug one.
    const both = withHost(MANIFEST, DEBUG);
    assert.deepEqual(both.hosts, [HOST, DEBUG]);
    const newerDebug = { ...DEBUG, sha256: 'e'.repeat(64) };
    assert.deepEqual(withHost(both, newerDebug).hosts, [HOST, newerDebug]);

    // An entry with no flavour is the release host, so a release entry replaces it.
    const release = { ...HOST, flavour: 'release' as const, sha256: 'b'.repeat(64) };
    assert.deepEqual(withHost(both, release).hosts, [DEBUG, release]);
  });
});

describe('choosePrebuilt', () => {
  it("takes the app's React Native version when its host libraries match or are absent", () => {
    assert.deepEqual(choosePrebuilt(MANIFEST, APP), { host: HOST });
  });

  it('takes a host for the OS asked, and a Linux host for the architecture asked', () => {
    const x64: PrebuiltHost = { ...HOST, os: 'linux', arch: 'x64', sha256: 'b'.repeat(64) };
    const arm64: PrebuiltHost = { ...HOST, os: 'linux', arch: 'arm64', sha256: 'c'.repeat(64) };
    const all = { version: 1, hosts: [x64, arm64, HOST] };
    // An entry that names no OS is a macOS one, whatever comes before it.
    assert.deepEqual(choosePrebuilt(all, APP), { host: HOST });
    assert.deepEqual(choosePrebuilt(all, { ...APP, os: 'linux', arch: 'arm64' }), { host: arm64 });
    assert.deepEqual(choosePrebuilt(all, { ...APP, os: 'linux', arch: 'x64' }), { host: x64 });
    assert.deepEqual(choosePrebuilt(MANIFEST, { ...APP, os: 'linux', arch: 'x64' }), {
      reason: 'no prebuilt release Linux x64 host for React Native 0.88.0',
    });
    // One Linux entry per architecture: a new arm64 host replaces only the arm64 one.
    const newer = { ...arm64, sha256: 'e'.repeat(64) };
    assert.deepEqual(withHost(all, newer).hosts, [x64, HOST, newer]);
  });

  it('takes the debug host for a dev run and the release host for a packaged app', () => {
    const release = { ...HOST, flavour: 'release' as const };
    const both = { version: 1, hosts: [release, DEBUG] };
    assert.deepEqual(choosePrebuilt(both, { ...APP, flavour: 'debug' }), { host: DEBUG });
    assert.deepEqual(choosePrebuilt(both, APP), { host: release });
    // In the other order too, so neither is picked for being first.
    const reversed = { version: 1, hosts: [DEBUG, release] };
    assert.deepEqual(choosePrebuilt(reversed, { ...APP, flavour: 'debug' }), { host: DEBUG });
    assert.deepEqual(choosePrebuilt(reversed, APP), { host: release });
  });

  it('reads an entry with no flavour as the release host', () => {
    assert.deepEqual(choosePrebuilt(MANIFEST, APP), { host: HOST });
    assert.deepEqual(choosePrebuilt(MANIFEST, { ...APP, flavour: 'debug' }), {
      reason: 'no prebuilt debug host for React Native 0.88.0',
    });
  });

  it('builds from source when only the other flavour fits', () => {
    const onlyDebug = { version: 1, hosts: [DEBUG] };
    assert.deepEqual(choosePrebuilt(onlyDebug, APP), {
      reason: 'no prebuilt release host for React Native 0.88.0',
    });
    const both = { version: 1, hosts: [HOST, DEBUG] };
    assert.deepEqual(choosePrebuilt(both, { ...APP, env: { NGN_DESKTOP_FROM_SOURCE: '1' } }), {
      reason: 'NGN_DESKTOP_FROM_SOURCE=1',
    });
    assert.deepEqual(
      choosePrebuilt(both, { ...APP, flavour: 'debug', env: { NGN_DESKTOP_FROM_SOURCE: '1' } }),
      { reason: 'NGN_DESKTOP_FROM_SOURCE=1' },
    );
  });

  it('builds from source for linked native code, another version, a library or a deny', () => {
    const reasons = [
      { linked: 1 },
      { reactNative: '0.88.1' },
      { libraries: { ...APP.libraries, 'react-native-screens': '4.21.0' } },
      { libraries: { ...APP.libraries, 'react-native-other': '1.0.0' } },
      { deny: ['react-native-screens'] },
      { env: { NGN_DESKTOP_FROM_SOURCE: '1' } },
    ].map((change) => choosePrebuilt(MANIFEST, { ...APP, ...change }));
    for (const choice of reasons) assert.ok('reason' in choice, JSON.stringify(choice));
    assert.match(
      (reasons[2] as { reason: string }).reason,
      /has react-native-screens 4\.20\.0, the app 4\.21\.0/,
    );
    assert.equal(choosePrebuilt({ version: 1, hosts: [] }, APP).hasOwnProperty('host'), false);
  });
});

/** A system for fetchPrebuilt: `curl` and `tar` answer as told, and files exist once made. */
function fakeFetch({
  curl = 0,
  tar = 0,
  sha = SHA,
  cached = false,
  finishedMeanwhile = false,
  rename = (_from: string, _to: string, _files: Set<string>): void => {},
} = {}) {
  const calls: string[][] = [];
  const files = new Set<string>(cached ? ['/c/prebuilt/aaaaaaaaaaaaaaaa/appkit/ngn-macos'] : []);
  const warnings: string[] = [];
  const removed: string[] = [];
  const renamed: [string, string][] = [];
  const sys = {
    exists: (file: string) => files.has(file),
    remove: (file: string) => void removed.push(file),
    writeFile: () => {},
    warn: (line: string) => void warnings.push(line),
    sha256: () => sha,
    rename: (from: string, to: string) => {
      renamed.push([from, to]);
      rename(from, to, files);
    },
    run(command: string, args: string[]) {
      calls.push([command, ...args]);
      if (command === 'curl') {
        // Another run unpacks the same host while this one downloads.
        if (finishedMeanwhile) files.add('/c/prebuilt/aaaaaaaaaaaaaaaa/appkit/ngn-macos');
        return { status: curl, stdout: '' };
      }
      if (command === 'tar' && tar === 0) {
        files.add(`${args[3]}/appkit/ngn-macos`);
      }
      return { status: tar, stdout: '' };
    },
  } as unknown as typeof system;
  return { sys, calls, warnings, removed, renamed };
}

describe('fetchPrebuilt', () => {
  const dir = '/c/prebuilt/aaaaaaaaaaaaaaaa';

  it('downloads, checks the SHA-256, unpacks and moves the host into the cache under its hash', () => {
    const { sys, calls, renamed } = fakeFetch();
    assert.equal(fetchPrebuilt(sys, HOST, '/c'), dir);
    assert.deepEqual(
      calls.map((call) => call[0]),
      ['curl', 'tar'],
    );
    assert.equal(calls[0]!.at(-1), HOST.url);
    const archive = calls[0]![calls[0]!.indexOf('-o') + 1]!;
    const unpacked = calls[1]![4]!;
    assert.match(archive, new RegExp(`^${dir}\\.${process.pid}-[0-9a-f]+\\.tar\\.gz$`));
    assert.match(unpacked, new RegExp(`^${dir}\\.${process.pid}-[0-9a-f]+\\.partial$`));
    assert.deepEqual(calls[1], ['tar', '-xzf', archive, '-C', unpacked]);
    assert.deepEqual(renamed, [[unpacked, dir]]);
  });

  it("gives each run temp files of its own, so a second run never deletes the first's download", () => {
    const first = fakeFetch();
    const second = fakeFetch();
    fetchPrebuilt(first.sys, HOST, '/c');
    fetchPrebuilt(second.sys, HOST, '/c');
    const archiveOf = (calls: string[][]) => calls[0]![calls[0]!.indexOf('-o') + 1]!;
    assert.notEqual(archiveOf(first.calls), archiveOf(second.calls));
    assert.notEqual(first.calls[1]![4], second.calls[1]![4]);
    // Nothing but its own files is removed, never the host's folder: no fixed name another run
    // could be writing.
    for (const { calls, removed } of [first, second]) {
      const own = [archiveOf(calls), calls[1]![4]!];
      assert.deepEqual(
        removed.filter((file) => !own.includes(file)),
        [],
      );
    }
  });

  it('uses the host another run unpacked meanwhile, and drops its own copy', () => {
    const { sys, calls, removed, renamed } = fakeFetch({ finishedMeanwhile: true });
    assert.equal(fetchPrebuilt(sys, HOST, '/c'), dir);
    assert.deepEqual(renamed, []);
    assert.ok(removed.includes(calls[1]![4]!));
    assert.ok(!removed.includes(dir), "the other run's host is kept");
  });

  it('uses the host a run that moved its copy in first published, and never deletes it', () => {
    const { sys, calls, removed } = fakeFetch({
      rename: (_from, to, files) => {
        // The other run's rename lands between this run's check and its own rename.
        files.add(`${to}/appkit/ngn-macos`);
        throw Object.assign(new Error('ENOTEMPTY'), { code: 'ENOTEMPTY' });
      },
    });
    assert.equal(fetchPrebuilt(sys, HOST, '/c'), dir);
    assert.ok(!removed.includes(dir), "the other run's host is kept");
    assert.ok(removed.includes(calls[1]![4]!), 'its own copy is dropped');
  });

  it('fails on any other rename error, and drops its own copy', () => {
    const { sys, calls, removed } = fakeFetch({
      rename: () => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      },
    });
    assert.throws(() => fetchPrebuilt(sys, HOST, '/c'), /EACCES/);
    assert.ok(!removed.includes(dir));
    assert.ok(removed.includes(calls[1]![4]!));
  });

  it('uses a host already in the cache without downloading it', () => {
    const { sys, calls } = fakeFetch({ cached: true });
    assert.equal(fetchPrebuilt(sys, HOST, '/c'), dir);
    assert.deepEqual(calls, []);
  });

  it('refuses and deletes a download whose SHA-256 is not the manifest', () => {
    const { sys, calls, removed, renamed } = fakeFetch({ sha: 'f'.repeat(64) });
    assert.throws(() => fetchPrebuilt(sys, HOST, '/c'), /has SHA-256 f+, not the a+/);
    assert.ok(removed.includes(calls[0]![calls[0]!.indexOf('-o') + 1]!));
    assert.ok(!calls.some((call) => call[0] === 'tar'), 'never unpacked');
    assert.deepEqual(renamed, []);
  });

  it('builds from source, with a warning, when the download fails', () => {
    const { sys, warnings } = fakeFetch({ curl: 22 });
    assert.equal(fetchPrebuilt(sys, HOST, '/c'), null);
    assert.match(warnings[0]!, /Could not download the prebuilt desktop host/);
  });

  it('fails on an archive that does not unpack to a host, and on a manifest with no hash', () => {
    assert.throws(() => fetchPrebuilt(fakeFetch({ tar: 1 }).sys, HOST, '/c'), /did not unpack/);
    assert.throws(
      () => fetchPrebuilt(fakeFetch().sys, { ...HOST, sha256: '' }, '/c'),
      /no SHA-256 to check/,
    );
  });
});

describe('signing the prebuilt host', () => {
  function fakeRun(status = 0) {
    const calls: { command: string; args: string[] }[] = [];
    const run = (command: string, args: string[]) => {
      calls.push({ command, args });
      return { status };
    };
    return { run, calls };
  }

  it('strips, then signs ad hoc with the hardened runtime when no identity is given', () => {
    const { run, calls } = fakeRun();
    signPrebuiltFiles(run, ['/a/ngn-macos', '/a/hermesc'], {});
    assert.deepEqual(calls, [
      { command: 'strip', args: ['-x', '/a/ngn-macos'] },
      {
        command: 'codesign',
        args: [
          '--force',
          '--options',
          'runtime',
          '--timestamp=none',
          '--sign',
          '-',
          '/a/ngn-macos',
        ],
      },
      { command: 'strip', args: ['-x', '/a/hermesc'] },
      {
        command: 'codesign',
        args: ['--force', '--options', 'runtime', '--timestamp=none', '--sign', '-', '/a/hermesc'],
      },
    ]);
  });

  it('signs a framework unstripped, and adds the ad hoc entitlements to an ad hoc signature only', () => {
    const adHoc = fakeRun();
    signPrebuiltFiles(adHoc.run, ['/a/hermesvm.framework'], {});
    assert.deepEqual(
      adHoc.calls.map((call) => call.command),
      ['codesign'],
    );
    signPrebuiltFiles(adHoc.run, ['/a/ngn-macos'], {}, '/s/host.entitlements');
    assert.deepEqual(adHoc.calls.at(-1)!.args.slice(4, 6), [
      '--entitlements',
      '/s/host.entitlements',
    ]);

    const identity = fakeRun();
    signPrebuiltFiles(
      identity.run,
      ['/a/ngn-macos'],
      { NGN_SIGN_IDENTITY: 'Developer ID Application: X' },
      '/s/host.entitlements',
    );
    assert.ok(!identity.calls.some((call) => call.args.includes('--entitlements')));
  });

  it('treats an empty NGN_SIGN_IDENTITY as none', () => {
    const { run, calls } = fakeRun();
    signPrebuiltFiles(run, ['/a/ngn-macos'], { NGN_SIGN_IDENTITY: '' });
    assert.equal(calls[1]!.args[calls[1]!.args.indexOf('--sign') + 1], '-');
  });

  it('signs with an identity, and a timestamp, when one is given', () => {
    const { run, calls } = fakeRun();
    signPrebuiltFiles(run, ['/a/ngn-macos'], { NGN_SIGN_IDENTITY: 'Developer ID Application: X' });
    assert.deepEqual(calls[1]!.args, [
      '--force',
      '--options',
      'runtime',
      '--timestamp',
      '--sign',
      'Developer ID Application: X',
      '/a/ngn-macos',
    ]);
  });

  it('fails when codesign fails', () => {
    assert.throws(() => signPrebuiltFiles(fakeRun(1).run, ['/a/ngn-macos'], {}), /failed/);
  });
});
