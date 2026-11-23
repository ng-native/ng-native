/**
 * A header's subtitle: the window's on macOS and the header bar's on Linux, which read it from the
 * header config's `subtitle`, and nothing at all on iOS and Android, whose react-native-screens has
 * no such prop. Unset on a desktop it is an empty one, so a subtitle shown before is cleared: an
 * undefined prop never reaches native, and the old one would stay.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, screen } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

describe('a header subtitle', () => {
  let mod: Record<string, unknown>;
  const subtitle = () => mod['subtitle'] as WritableSignal<string | undefined>;

  before(async () => {
    mod = await compileFixture('fixtures/header-subtitle.ts');
  });

  afterEach(() => {
    cleanup();
    registerPlatformComponents('ios');
    subtitle().set('3 waiting');
  });

  const open = async (platform: string) => {
    registerPlatformComponents(platform);
    const app = await render(mod['HeaderSubtitle'] as Type<unknown>);
    return app;
  };

  for (const platform of ['macos', 'linux']) {
    it(`goes to the header config on ${platform}, and is cleared when unset`, async () => {
      const app = await open(platform);
      assert.equal(screen.getByTestId('bar').props['subtitle'], '3 waiting');
      subtitle().set('2 waiting');
      await app.detectChanges();
      assert.equal(screen.getByTestId('bar').props['subtitle'], '2 waiting');
      subtitle().set(undefined);
      await app.detectChanges();
      assert.equal(screen.getByTestId('bar').props['subtitle'], '');
    });
  }

  for (const platform of ['ios', 'android']) {
    it(`is not sent on ${platform}`, async () => {
      await open(platform);
      assert.equal('subtitle' in screen.getByTestId('bar').props, false);
    });
  }
});
