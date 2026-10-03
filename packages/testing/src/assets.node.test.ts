/**
 * The node:test half of `assets.vitest.test.ts`: an ES module under Node has no `require` either,
 * so the hook stands in `{ testUri }` for a required image the same way the Vitest plugin does.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Component } from '@angular/core';
import { Image, Text } from '@ng-native/components';
import { render, screen } from '@ng-native/testing';

@Component({
  selector: 'app-logo',
  imports: [Image],
  template: `<image testID="logo" [source]="logo" />`,
})
class Logo {
  readonly logo = require('./assets/logo.png');
}

test('a required image renders, with the path it was required by', async () => {
  const { instance } = await render(Logo);

  assert.deepEqual(instance.logo, { testUri: './assets/logo.png' });
  assert.ok(screen.getByTestId('logo'));
});

/**
 * A font declared in a stylesheet, as the fonts page says to. The compiler writes its
 * `require('./brand.ttf')` into the compiled sheet, so it is not in the source a stand-in could be
 * found in, and the file would fail to load before any test ran.
 */
@Component({
  selector: 'app-brand',
  imports: [Text],
  template: `<text>Brand</text>`,
  styles: `
    @font-face {
      font-family: 'Brand';
      src: url('./brand.ttf');
    }
    @font-face {
      font-family: 'Brand';
      font-weight: 700;
      src: url('./brand-bold.woff2');
    }
  `,
})
class Brand {}

test('a component whose stylesheet declares a font face loads and renders', async () => {
  await render(Brand);
  assert.ok(screen.getByText('Brand'));
});
