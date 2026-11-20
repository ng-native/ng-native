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
import { matchScreenshot, screenshotPath, type ScreenshotRequest } from './screenshot-baselines.ts';

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
    assert.equal(
      path.basename(screenshotPath('/app/a.device.ts', '..', 'ios')),
      'screenshot-ios.png',
    );
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

  it('match only the same pixels by default', () => {
    inTemp((file) => {
      matchScreenshot(request(file));
      assert.equal(matchScreenshot(request(file)).pass, true);
      const changed = matchScreenshot(request(file, { png: png(4, 4, [5], 1) }));
      assert.equal(changed.pass, false, 'one pixel, one step of red, is a difference');
      assert.match(changed.message!, /^1 of 16 pixels/);
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
      assert.equal(
        matchScreenshot(
          request(file, { png: png(4, 4, [1], 1), comparatorOptions: { threshold: 0.1 } }),
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
