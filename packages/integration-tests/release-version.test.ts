/**
 * `scripts/release-version.mjs`: the Release workflow's first job, which refuses a version before
 * the native builds and the setup checks spend half an hour on it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const script = new URL('../../scripts/release-version.mjs', import.meta.url);
const { compare, releaseVersion } = (await import(script.href)) as {
  compare(a: string, b: string): number;
  releaseVersion(bump: string, exact: string, published: string[], current: string): string;
};

// What npm has, across every package: one never published adds nothing.
const published = ['0.0.1', '0.17.0', '0.17.1', '0.18.0', '0.18.1'];

describe('the version a release takes', () => {
  it('is the bump when no exact version is given', () => {
    assert.equal(releaseVersion('minor', '', published, '0.18.1'), 'minor');
    assert.equal(releaseVersion('patch', '  ', published, '0.18.1'), 'patch');
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
