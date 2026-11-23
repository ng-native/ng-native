/**
 * `scripts/release-version.mjs`: the Release workflow's first job, which refuses a version before
 * the native builds and the setup checks spend half an hour on it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const script = new URL('../../scripts/release-version.mjs', import.meta.url);
const { checkPublishing, compare, lastTagged, releaseVersion } = (await import(script.href)) as {
  checkPublishing(packages: { name: string; versions: string[]; trusted?: boolean }[]): void;
  compare(a: string, b: string): number;
  lastTagged(lsRemote: string): string;
  releaseVersion(bump: string, exact: string, published: string[], current: string): string;
};

// What npm has, across every package.
const published = ['0.0.1', '0.17.0', '0.17.1', '0.18.0', '0.18.1'];

// `main` never gets a release commit, so a bump starts from the highest tag, not the version on disk.
describe('the last release', () => {
  it("is the highest v<version> tag by semver, not by the tags' order", () => {
    const lsRemote = [
      'aaa\trefs/tags/v0.9.0',
      'bbb\trefs/tags/v0.27.0',
      'ccc\trefs/tags/v0.27.0^{}',
      'ddd\trefs/tags/v0.28.0-rc.0',
      'eee\trefs/tags/v0.3.0',
      'fff\trefs/tags/vnext',
    ].join('\n');
    assert.equal(lastTagged(lsRemote), '0.28.0-rc.0');
    assert.equal(lastTagged(lsRemote.replace('v0.28.0-rc.0', 'v0.26.0')), '0.27.0');
  });

  it('refuses a release with no tag to start from', () => {
    assert.throws(() => lastTagged(''), /no v<version> tag/);
  });
});

describe('the version a release takes', () => {
  // Every job takes this output as the version, the prebuilt desktop hosts' URLs included, so a
  // bump comes out as the version nx release makes of it from the last release's.
  it('is the version the bump makes when no exact version is given', () => {
    assert.equal(releaseVersion('minor', '', published, '0.18.1'), '0.19.0');
    assert.equal(releaseVersion('patch', '  ', published, '0.18.1'), '0.18.2');
  });

  it('bumps a prerelease as semver does', () => {
    const rc = [...published, '0.19.0-rc.0', '0.19.1-rc.0'];
    assert.equal(releaseVersion('minor', '', rc, '0.19.0-rc.0'), '0.19.0');
    assert.equal(releaseVersion('minor', '', rc, '0.19.1-rc.0'), '0.20.0');
    assert.equal(releaseVersion('patch', '', rc, '0.19.1-rc.0'), '0.19.1');
  });

  it('is the exact version over the bump', () => {
    assert.equal(releaseVersion('minor', '0.18.2', published, '0.18.1'), '0.18.2');
    assert.equal(releaseVersion('patch', ' 0.20.0 ', published, '0.18.1'), '0.20.0');
    assert.equal(releaseVersion('patch', '0.19.0-rc.0', published, '0.18.1'), '0.19.0-rc.0');
  });

  it('refuses a bump other than minor or patch', () => {
    assert.throws(() => releaseVersion('major', '', published, '0.18.1'), {
      message: 'The bump must be minor or patch, not "major".',
    });
  });

  it('refuses a new major, saying so', () => {
    assert.throws(() => releaseVersion('minor', '1.0.0', published, '0.18.1'), {
      message:
        '1.0.0 is a new major version, and releases stay on 0.x: the latest published is 0.18.1. Give a 0.x version above it, or leave the version empty to bump.',
    });
    assert.throws(() => releaseVersion('minor', '2.0.0-rc.0', published, '0.18.1'), /new major/);
  });

  it('refuses a version not above the latest published', () => {
    assert.throws(() => releaseVersion('minor', '0.18.0', published, '0.18.1'), {
      message:
        '0.18.0 is not above 0.18.1, the latest published. Give a version above it, or leave the version empty to bump.',
    });
    assert.throws(
      () => releaseVersion('minor', '0.18.1-rc.0', published, '0.18.1'),
      /not above 0\.18\.1/,
    );
  });

  it('refuses the latest published once its release finished', () => {
    assert.throws(() => releaseVersion('minor', '0.18.1', published, '0.18.1'), {
      message:
        '0.18.1 is already released. Give a version above it, or leave the version empty to bump.',
    });
  });

  it('takes the latest published again while main is still below it, to finish that release', () => {
    assert.equal(releaseVersion('minor', '0.19.0', [...published, '0.19.0'], '0.18.1'), '0.19.0');
  });

  it('refuses what is not a plain version', () => {
    for (const exact of ['v0.19.0', '0.19', '0.19.0+build', '00.19.0', 'minor']) {
      assert.throws(() => releaseVersion('minor', exact, published, '0.18.1'), /is not a version/);
    }
  });

  it('is measured against prereleases too', () => {
    assert.throws(
      () => releaseVersion('minor', '0.19.0-rc.1', [...published, '0.19.0-rc.2'], '0.18.1'),
      /not above 0\.19\.0-rc\.2/,
    );
  });
});

describe('the packages a release publishes', () => {
  it('passes when each exists and trusts the workflow, or its trust was not checked', () => {
    checkPublishing([
      { name: '@ng-native/fabric', versions: ['0.0.1', '0.18.1'], trusted: true },
      { name: '@ng-native/router', versions: ['0.18.1'] },
    ]);
  });

  it('refuses a package that has never been published', () => {
    assert.throws(
      () =>
        checkPublishing([
          { name: '@ng-native/fabric', versions: ['0.18.1'], trusted: true },
          { name: '@ng-native/nativescript', versions: [] },
        ]),
      {
        message:
          '@ng-native/nativescript has never been published, so npm cannot trust this workflow to publish it. Publish a placeholder of it by hand and configure its trusted publisher: see "Adding a package" in docs/RELEASING.md.',
      },
    );
  });

  it('refuses a package whose trusted publisher is not this workflow', () => {
    assert.throws(
      () =>
        checkPublishing([{ name: '@ng-native/nativescript', versions: ['0.0.0'], trusted: false }]),
      {
        message:
          'npm doesn\'t trust this workflow to publish @ng-native/nativescript. Configure its trusted publisher (repository ng-native/ng-native, workflow release.yml): see "Adding a package" in docs/RELEASING.md.',
      },
    );
  });

  it('names every package that would fail, one per line', () => {
    assert.throws(
      () =>
        checkPublishing([
          { name: '@ng-native/a', versions: [] },
          { name: '@ng-native/b', versions: ['0.18.1'], trusted: true },
          { name: '@ng-native/c', versions: ['0.0.0'], trusted: false },
        ]),
      (error: Error) => {
        const lines = error.message.split('\n');
        assert.equal(lines.length, 2);
        assert.match(lines[0], /^@ng-native\/a has never been published/);
        assert.match(lines[1], /trust this workflow to publish @ng-native\/c\./);
        return true;
      },
    );
  });
});

describe('semver precedence', () => {
  it('orders versions as semver.org does', () => {
    // semver.org's own example, from lowest to highest.
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '2.0.0',
      '10.0.0',
    ];
    for (let at = 1; at < ordered.length; at++) {
      assert.ok(compare(ordered[at - 1], ordered[at]) < 0, `${ordered[at - 1]} < ${ordered[at]}`);
      assert.ok(compare(ordered[at], ordered[at - 1]) > 0, `${ordered[at]} > ${ordered[at - 1]}`);
    }
    assert.equal(compare('0.18.1', '0.18.1'), 0);
  });
});
