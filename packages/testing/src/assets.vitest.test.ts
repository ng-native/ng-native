/**
 * An image referenced the React Native way, `require('./logo.png')`, which Metro turns into an
 * asset id. Vitest runs modules with no `require`, so the plugin stands in a `{ testUri }` the
 * way React Native's Jest preset does, rather than let the module throw as it is evaluated.
 */
import { Component } from '@angular/core';
import { Image, Text } from '@ng-native/components';
import { render, screen } from '@ng-native/testing';
import { expect, test } from 'vitest';

@Component({
  selector: 'app-logo',
  imports: [Image],
  template: `<image testID="logo" [source]="logo" />`,
})
class Logo {
  protected readonly logo = require('./assets/logo.png');
}

test('a required image renders, with the path it was required by', async () => {
  const { instance } = await render(Logo);

  expect((instance as unknown as { logo: unknown }).logo).toEqual({ testUri: './assets/logo.png' });
  expect(screen.getByTestId('logo')).toBeTruthy();
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
  expect(screen.getByText('Brand')).toBeTruthy();
});
