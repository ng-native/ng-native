import { Component, ElementRef, viewChild } from '@angular/core';
import { PressBehavior, Pressable } from '../../components/src/pressable.ts';
import { ScrollView } from '../../components/src/scroll-view.ts';
import { Text } from '../../components/src/text.ts';
import { TouchableOpacity } from '../../components/src/touchable-opacity.ts';
import { View } from '../../components/src/view.ts';
import { VirtualList } from '../../components/src/virtual-list.ts';

/** A button composed onto its own host, which names the element an event reports. */
@Component({
  selector: 'x-observed-button',
  template: `<ng-content />`,
  hostDirectives: [{ directive: PressBehavior, outputs: ['press'] }],
})
export class ObservedButton {}

/** Every kind of touchable, a scroll view and a list, each logging its own presses. */
@Component({
  selector: 'x-interaction-observer',
  imports: [ObservedButton, Pressable, ScrollView, Text, TouchableOpacity, View, VirtualList],
  template: `
    <scroll-view #scroll testID="list">
      <pressable
        testID="save"
        nativeID="save-button"
        accessibilityLabel="Save the draft"
        role="button"
        (press)="log('save')"
      >
        <text>Save</text>
        <view><text> draft now </text></view>
      </pressable>
      <pressable testID="silent"><text>Nothing happens</text></pressable>
      <pressable
        testID="hold"
        [delayLongPress]="5"
        (press)="log('hold press')"
        (longPress)="log('hold long')"
      />
      <pressable testID="slow" (press)="log('slow press')" />
      <touchable-opacity testID="fade" aria-label="Fade" (press)="log('fade')" />
      <text testID="link" pressable (press)="log('link')">Read more</text>
      <text testID="label">Just a label</text>
      <x-observed-button testID="composed" (press)="log('composed')" />
      <pressable testID="spaced"
        ><text>{{ spacedText }}</text></pressable
      >
      <pressable testID="long-text"
        ><text>{{ longText }}</text></pressable
      >
      <pressable testID="off" [disabled]="true" (press)="log('off')" />
    </scroll-view>
    <virtual-list testID="rows" [items]="rows" [itemHeight]="20" [style]="{ height: 60 }" />
  `,
})
export class InteractionObserverFixture {
  readonly events: string[] = [];
  readonly longText = 'word '.repeat(60);
  readonly spacedText = '  Two\n   lines  ';
  /** The scroll view's own node, to see what it listens for. */
  readonly scroll = viewChild.required('scroll', { read: ElementRef });
  readonly rows = [1, 2, 3];

  log(event: string): void {
    this.events.push(event);
  }
}
