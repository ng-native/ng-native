import { Component, signal } from '@angular/core';
import { Pressable } from '../../components/src/pressable.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';
import { UiBottomSheet, UiButton, UiToolbarItem } from '../../expo/src/expo-ui-components.ts';

/**
 * A sheet with a row of its own and a Save in its bar, as an app writes one, and a row a view in the
 * sheet stops touches to.
 */
@Component({
  selector: 'x-testing-bottom-sheet',
  imports: [Pressable, Text, UiBottomSheet, UiButton, UiToolbarItem, View],
  template: `
    <ui-bottom-sheet [(open)]="open">
      <ui-toolbar-item placement="confirmationAction">
        <ui-button testID="save" label="Save" (buttonPress)="saved.set(saved() + 1)" />
      </ui-toolbar-item>
      <pressable accessibilityRole="button" (press)="count.set(count() + 1)">
        <text>Tap {{ count() }}</text>
      </pressable>
      <view pointerEvents="none">
        <pressable testID="covered" (press)="count.set(count() + 100)"
          ><text>Covered</text></pressable
        >
      </view>
    </ui-bottom-sheet>
  `,
})
export class TestingBottomSheetFixture {
  readonly open = signal(true);
  readonly count = signal(0);
  readonly saved = signal(0);
}
