import { Component, signal } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { render, screen, setAnimations } from '@ng-native/testing/device';
import { expect, it } from 'vitest';

@Component({
  selector: 'test-swatch',
  imports: [Text, View],
  styles: [
    `
      .frame {
        margin: 40px 20px;
        width: 320px;
        padding: 10px;
        background-color: white;
      }
      .swatch {
        width: 300px;
        height: 100px;
        border-radius: 12px;
        background-color: #3366cc;
        transition: background-color 2s linear;
      }
      .swatch.warm {
        background-color: #cc6633;
      }
    `,
  ],
  template: `
    <view testID="frame" class="frame">
      <view testID="swatch" class="swatch" [class.warm]="warm()"></view>
    </view>
  `,
})
class Swatch {
  readonly warm = signal(false);
}

it('commits the style, lays the swatch out and draws its colour', async () => {
  await render(Swatch);
  const swatch = screen.getByTestId('swatch');
  expect(swatch).toHaveStyle({ backgroundColor: '#3366cc', borderRadius: 12 });
  expect(swatch).toHaveSize({ width: 300, height: 100 });
  expect(swatch).toBeWithin(screen.getByTestId('frame'));
  await expect(swatch).toHaveColorAt({ x: 150, y: 50 }, '#3366cc');
});

it('lands a transition at once with animations off', async () => {
  await setAnimations(false);
  const { instance, settle } = await render(Swatch);
  instance.warm.set(true);
  await settle();
  const swatch = screen.getByTestId('swatch');
  expect(swatch).toHaveStyle({ backgroundColor: '#cc6633' });
  await expect(swatch).toHaveColorAt({ x: 150, y: 50 }, '#cc6633');
});
