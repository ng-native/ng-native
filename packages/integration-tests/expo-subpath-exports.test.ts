/**
 * The components `@ng-native/expo` also ships under a subpath of their own, as `./search-field`
 * is, so an app can import one without the package root. Each subpath is the same class the root
 * exports, in both the source `exports` and the published ones.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DateTimePicker, SegmentedControl } from '@ng-native/expo';

const manifest = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '../expo/package.json'), 'utf8'),
) as {
  exports: Record<string, string>;
  publishConfig: { exports: Record<string, { types: string; default: string }> };
};

describe('the expo package subpaths', () => {
  it('imports DateTimePicker from ./date-time-picker', async () => {
    const subpath = await import('@ng-native/expo/date-time-picker');
    assert.equal(subpath.DateTimePicker, DateTimePicker);
  });

  it('imports SegmentedControl from ./segmented-control', async () => {
    const subpath = await import('@ng-native/expo/segmented-control');
    assert.equal(subpath.SegmentedControl, SegmentedControl);
  });

  it('publishes both beside ./search-field', () => {
    for (const name of ['date-time-picker', 'segmented-control']) {
      assert.deepEqual(manifest.publishConfig.exports[`./${name}`], {
        types: `./dist/${name}.d.ts`,
        default: `./dist/${name}.js`,
      });
      assert.equal(manifest.exports[`./${name}`], `./src/${name}.ts`);
    }
  });
});
