import { Component } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { measure, render, screen } from '@ng-native/testing/device';
import { expect, it } from 'vitest';

@Component({
  selector: 'test-card',
  imports: [Text, View],
  template: `
    <view
      testID="card"
      style="margin: 40px 20px; width: 300px; padding: 16px; border-radius: 16px; background-color: #3366cc"
    >
      <text style="color: white; font-size: 20px">A card</text>
      <text style="color: #dde6ff; font-size: 14px; margin-top: 8px">Drawn natively</text>
    </view>
  `,
})
class Card {}

it('lays the card out to its width', async () => {
  await render(Card);
  expect(measure(screen.getByTestId('card'))!.width).toBeCloseTo(300, 0);
});

it('draws the card', async () => {
  await render(Card);
  await expect(screen.getByTestId('card')).toMatchScreenshot('card');
});
