import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { system } from './host.mjs';
import {
  choosePrebuilt,
  fetchPrebuilt,
  prebuiltName,
  readManifest,
  withHost,
  type PrebuiltHost,
} from './prebuilt.mjs';

const SHA = 'a'.repeat(64);
const HOST: PrebuiltHost = {
  reactNative: '0.88.0',
  url: 'https://example.com/host.tar.gz',
  sha256: SHA,
  libraries: { 'react-native-screens': '4.20.0', 'react-native-safe-area-context': '5.10.1' },
};
const MANIFEST = { version: 1, hosts: [HOST] };
const APP = {
  reactNative: '0.88.0',
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
  });

  it('reads a manifest, and anything else as none', () => {
    assert.deepEqual(readManifest(JSON.stringify(MANIFEST)), MANIFEST);
    for (const text of ['', '{', '{"version":2,"hosts":[]}', '{"version":1}']) {
      assert.deepEqual(readManifest(text), { version: 1, hosts: [] });
    }
  });

  it('keeps one host per React Native version', () => {
    const newer = { ...HOST, sha256: 'b'.repeat(64) };
    const other = { ...HOST, reactNative: '0.89.0' };
    assert.deepEqual(withHost(withHost(MANIFEST, other), newer).hosts, [other, newer]);
  });
});

describe('choosePrebuilt', () => {
  it("takes the app's React Native version when its host libraries match or are absent", () => {
    assert.deepEqual(choosePrebuilt(MANIFEST, APP), { host: HOST });
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
function fakeFetch({ curl = 0, tar = 0, sha = SHA, cached = false } = {}) {
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
    rename: (from: string, to: string) => void renamed.push([from, to]),
    run(command: string, args: string[]) {
      calls.push([command, ...args]);
      if (command === 'curl') return { status: curl, stdout: '' };
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
    assert.deepEqual(calls[1], ['tar', '-xzf', `${dir}.tar.gz`, '-C', `${dir}.partial`]);
    assert.deepEqual(renamed, [[`${dir}.partial`, dir]]);
  });

  it('uses a host already in the cache without downloading it', () => {
    const { sys, calls } = fakeFetch({ cached: true });
    assert.equal(fetchPrebuilt(sys, HOST, '/c'), dir);
    assert.deepEqual(calls, []);
  });

  it('refuses and deletes a download whose SHA-256 is not the manifest', () => {
    const { sys, calls, removed, renamed } = fakeFetch({ sha: 'f'.repeat(64) });
    assert.throws(() => fetchPrebuilt(sys, HOST, '/c'), /has SHA-256 f+, not the a+/);
    assert.ok(removed.includes(`${dir}.tar.gz`));
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
