import { Component, signal } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';
import { measure, press, render, screen } from '@ng-native/testing/device';
import { expect, it } from 'vitest';
import { Platform } from 'react-native';

// Runs inside the app on the desktop host's native views: `npx vitest --project linux` on the GTK
// host, `--project macos` on AppKit.
@Component({
  selector: 'test-row',
  imports: [Pressable, Text, View],
  template: `
    <view testID="row" style="flex-direction: row; width: 300px; height: 40px">
      <view testID="left" style="width: 100px; background-color: red"></view>
      <view testID="right" style="flex: 1; background-color: blue"></view>
    </view>
    <pressable testID="button" (press)="count.set(count() + 1)" style="width: 120px; height: 44px">
      <text testID="label">Pressed {{ count() }}</text>
    </pressable>
  `,
})
class Row {
  readonly count = signal(0);
}

it('runs on a desktop host', () => {
  expect(['macos', 'linux']).toContain(Platform.OS);
});

it('lays the row out as the host does', async () => {
  await render(Row);
  const left = measure(screen.getByTestId('left'))!;
  const right = measure(screen.getByTestId('right'))!;
  expect(left.width).toBeCloseTo(100, 0);
  expect(right.width).toBeCloseTo(200, 0);
  expect(right.x - left.x).toBeCloseTo(100, 0);
});

it('presses through the engine', async () => {
  const { settle } = await render(Row);
  await press(screen.getByTestId('button'));
  await settle();
  expect(screen.getByText('Pressed 1')).toBeTruthy();
});
