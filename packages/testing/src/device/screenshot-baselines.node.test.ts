/**
 * The pool's half of `toMatchScreenshot()`: where a reference lives, when one is recorded, and how
 * a capture is compared with it.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PNG } from 'pngjs';
import {
  matchScreenshot,
  screenshotPath,
  type ScreenshotPathData,
  type ScreenshotRequest,
} from './screenshot-baselines.ts';

/** A PNG in base64, `width` by `height`, one colour, with the pixels at `changed` another. */
function png(width: number, height: number, changed: number[] = [], shift = 255): string {
  const image = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const red = changed.includes(i) ? shift : 0;
    image.data.set([red, 0, 128, 255], i * 4);
  }
  return PNG.sync.write(image).toString('base64');
}

function inTemp(run: (file: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'ng-native-screenshots-'));
  try {
    run(path.join(dir, 'card.device.ts'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const request = (file: string, over: Partial<ScreenshotRequest> = {}): ScreenshotRequest => ({
  file,
  name: 'card',
  platform: 'ios',
  png: png(4, 4),
  update: 'new',
  ...over,
});

describe('screenshot references', () => {
  it('live in __screenshots__ beside the test, by file, name and platform', () => {
    assert.equal(
      screenshotPath('/app/src/card.device.ts', 'card', 'android'),
      '/app/src/__screenshots__/card.device.ts/card-android.png',
    );
  });

  it('keep a name to one file in that directory', () => {
    assert.equal(
      path.dirname(screenshotPath('/app/a.device.ts', '../../etc/passwd', 'ios')),
      '/app/__screenshots__/a.device.ts',
    );
    assert.match(
      path.basename(screenshotPath('/app/a.device.ts', '..', 'ios')),
      /^screenshot-\w{8}-ios\.png$/,
    );
  });

  it('keep two names apart that differ only in what a file name cannot hold', () => {
    const save = screenshotPath('/app/a.device.ts', '保存', 'ios');
    const cancel = screenshotPath('/app/a.device.ts', '取消', 'ios');
    assert.notEqual(save, cancel);
    assert.equal(
      save,
      screenshotPath('/app/a.device.ts', '保存', 'ios'),
      'the same name, the same file',
    );
    assert.equal(path.basename(screenshotPath('/app/a.device.ts', 'card', 'ios')), 'card-ios.png');
  });

  it('are where resolveScreenshotPath puts them, from what Vitest browser mode gives it', () => {
    const given: ScreenshotPathData[] = [];
    const resolveScreenshotPath = (data: ScreenshotPathData) => {
      given.push(data);
      const { root, testFileDirectory, screenshotDirectory, testFileName, name, platform } = data;
      return path.join(
        root,
        testFileDirectory,
        screenshotDirectory,
        testFileName,
        `${name}-${platform}-ci${data.ext}`,
      );
    };
    const location = { root: '/ws/apps/app', resolveScreenshotPath };
    assert.equal(
      screenshotPath('/ws/libs/ui/src/card.device.ts', 'card', 'android', location),
      '/ws/libs/ui/src/__screenshots__/card.device.ts/card-android-ci.png',
    );
    assert.deepEqual(given, [
      {
        name: 'card',
        ext: '.png',
        platform: 'android',
        host: process.platform,
        root: '/ws/apps/app',
        testFileDirectory: '../../libs/ui/src',
        testFileName: 'card.device.ts',
        screenshotDirectory: '__screenshots__',
      },
    ]);
    screenshotPath('/ws/apps/app/src/a.device.ts', '../../etc/passwd', 'ios', location);
    assert.equal(
      `${given[1]!.name}-ios.png`,
      path.basename(screenshotPath('/ws/apps/app/src/a.device.ts', '../../etc/passwd', 'ios')),
      'the name as a file name, as the default path has it',
    );
    assert.equal(given[1]!.testFileDirectory, 'src');
    assert.equal(
      screenshotPath('/ws/apps/app/src/a.device.ts', 'card', 'ios', {
        root: '/ws/apps/app',
        resolveScreenshotPath: ({ name, host }) => `screenshots/${name}-${host}.png`,
      }),
      `/ws/apps/app/screenshots/card-${process.platform}.png`,
      "a relative path is from the project's root",
    );
  });

  it('keep their default path with a root and no resolveScreenshotPath', () => {
    assert.equal(
      screenshotPath('/ws/libs/ui/card.device.ts', 'card', 'ios', { root: '/ws/apps/app' }),
      screenshotPath('/ws/libs/ui/card.device.ts', 'card', 'ios'),
    );
  });

  it('keep the capture and difference beside the reference resolveScreenshotPath names', () => {
    inTemp((file) => {
      const location = {
        root: path.dirname(file),
        resolveScreenshotPath: ({ name, platform, ext }: ScreenshotPathData) =>
          `refs/${name}-${platform}-host${ext}`,
      };
      const reference = path.join(path.dirname(file), 'refs/card-ios-host.png');
      assert.equal(matchScreenshot(request(file), {}, location).reference, reference);
      assert.equal(existsSync(reference), true);
      const failed = matchScreenshot(request(file, { png: png(4, 4, [0]) }), {}, location);
      assert.equal(failed.pass, false);
      assert.equal(
        existsSync(path.join(path.dirname(reference), 'card-ios-host-actual.png')),
        true,
      );
      assert.equal(existsSync(path.join(path.dirname(reference), 'card-ios-host-diff.png')), true);
    });
  });

  it('are recorded when there is none, and the capture passes', () => {
    inTemp((file) => {
      const result = matchScreenshot(request(file));
      assert.equal(result.pass, true);
      assert.equal(readFileSync(result.reference).toString('base64'), png(4, 4));
    });
  });

  it('are not recorded on CI, where the capture is kept beside where the reference goes', () => {
    inTemp((file) => {
      const result = matchScreenshot(request(file, { update: 'none' }));
      assert.equal(result.pass, false);
      assert.match(result.message!, /No reference screenshot/);
      assert.equal(existsSync(result.reference), false);
      assert.equal(existsSync(result.reference.replace(/\.png$/, '-actual.png')), true);
    });
  });

  it('match only pixels within a step of each channel by default, and exactly at a tolerance of 0', () => {
    inTemp((file) => {
      matchScreenshot(request(file));
      assert.equal(matchScreenshot(request(file)).pass, true);
      assert.equal(
        matchScreenshot(request(file, { png: png(4, 4, [5], 1) })).pass,
        true,
        'one step of red, as a simulator varies between runs',
      );
      const changed = matchScreenshot(request(file, { png: png(4, 4, [5], 2) }));
      assert.equal(changed.pass, false, 'two steps of red is a difference');
      assert.match(changed.message!, /^1 of 16 pixels/);
      const exact = matchScreenshot(
        request(file, { png: png(4, 4, [5], 1), comparatorOptions: { channelTolerance: 0 } }),
      );
      assert.equal(exact.pass, false, 'at 0, one step is a difference');
    });
  });

  it('allow what the options allow, from the project or the call', () => {
    inTemp((file) => {
      matchScreenshot(request(file));
      const two = png(4, 4, [1, 2]);
      assert.equal(matchScreenshot(request(file, { png: two })).pass, false);
      assert.equal(
        matchScreenshot(request(file, { png: two }), { allowedMismatchedPixels: 2 }).pass,
        true,
      );
      assert.equal(
        matchScreenshot(
          request(file, { png: two, comparatorOptions: { allowedMismatchedPixelRatio: 0.125 } }),
        ).pass,
        true,
      );
      assert.equal(
        matchScreenshot(
          request(file, { png: two, comparatorOptions: { allowedMismatchedPixels: 1 } }),
          {
            allowedMismatchedPixels: 2,
          },
        ).pass,
        false,
        "the call's options win over the project's",
      );
      assert.equal(matchScreenshot(request(file, { png: png(4, 4, [1], 10) })).pass, false);
      assert.equal(
        matchScreenshot(
          request(file, { png: png(4, 4, [1], 10), comparatorOptions: { threshold: 0.1 } }),
        ).pass,
        true,
        'a threshold lets a small change of colour through',
      );
    });
  });

  it('write the capture and a difference on a failure, and remove both once it matches', () => {
    inTemp((file) => {
      const { reference } = matchScreenshot(request(file));
      const actual = reference.replace(/\.png$/, '-actual.png');
      const difference = reference.replace(/\.png$/, '-diff.png');
      matchScreenshot(request(file, { png: png(4, 4, [0]) }));
      assert.equal(existsSync(actual), true);
      assert.equal(existsSync(difference), true);
      assert.equal(matchScreenshot(request(file)).pass, true);
      assert.equal(existsSync(actual), false);
      assert.equal(existsSync(difference), false);
    });
  });

  it('fail on a change of size, without a difference image', () => {
    inTemp((file) => {
      const { reference } = matchScreenshot(request(file));
      matchScreenshot(request(file, { png: png(4, 4, [0]) }));
      const result = matchScreenshot(request(file, { png: png(5, 4) }));
      assert.equal(result.pass, false);
      assert.match(result.message!, /5x4px, and its reference 4x4px/);
      assert.equal(
        existsSync(reference.replace(/\.png$/, '-diff.png')),
        false,
        'an older one goes',
      );
    });
  });

  it('are replaced under -u, whatever they held', () => {
    inTemp((file) => {
      const { reference } = matchScreenshot(request(file));
      matchScreenshot(request(file, { png: png(4, 4, [0]) }));
      const result = matchScreenshot(request(file, { png: png(4, 4, [0]), update: 'all' }));
      assert.equal(result.pass, true);
      assert.equal(readFileSync(reference).toString('base64'), png(4, 4, [0]));
      assert.equal(existsSync(reference.replace(/\.png$/, '-actual.png')), false);
    });
  });
});
