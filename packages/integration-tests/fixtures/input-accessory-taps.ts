import { Component, signal } from '@angular/core';
import { InputAccessoryView } from '../../components/src/input-accessory-view.ts';
import { Pressable } from '../../components/src/pressable.ts';
import { ScrollView } from '../../components/src/scroll-view.ts';
import { Text } from '../../components/src/text.ts';
import { TextInput } from '../../components/src/text-input.ts';
import { View } from '../../components/src/view.ts';

/**
 * A field with a bar above the keyboard, both written inside a scroll view, as the issue's form
 * writes them: a disabled button in the bar, the gap beside it, and a view of the scroll view's own.
 */
@Component({
  selector: 'x-input-accessory-taps',
  imports: [InputAccessoryView, Pressable, ScrollView, Text, TextInput, View],
  template: `
    <scroll-view nativeID="scroll" [keyboardShouldPersistTaps]="persist()">
      <text-input nativeID="field" inputAccessoryViewID="bar" />
      <input-accessory-view nativeID="bar">
        <view nativeID="gap">
          <pressable nativeID="up" [disabled]="true"><text>Up</text></pressable>
        </view>
      </input-accessory-view>
      <view nativeID="elsewhere"><text>tap here</text></view>
    </scroll-view>
  `,
})
export class InputAccessoryTapsFixture {
  readonly persist = signal<'never' | 'handled'>('handled');
}
