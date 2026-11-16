import { Component, Directive, ElementRef, viewChild } from '@angular/core';
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

/** A design-system button, with its pressable inside its template. */
@Component({
  selector: 'x-wrapped-button',
  imports: [Pressable, Text],
  template: `<pressable testID="wrapped" (press)="pressed = true"><text>Wrapped</text></pressable>`,
})
export class WrappedButton {
  pressed = false;
}

/** An element only a directive matches: not a component, so never the one an event names. */
@Directive({ selector: 'x-region' })
export class Region {}

/** A card with a pressable and a scroll view of its own, a wrapped button and a slot. */
@Component({
  selector: 'x-observed-card',
  imports: [ObservedButton, Pressable, Region, ScrollView, View, WrappedButton],
  template: `
    <view>
      <pressable testID="card-action" />
      <x-region><pressable testID="in-region" /></x-region>
      <x-observed-button testID="composed-in-card" />
      <x-wrapped-button />
      <scroll-view testID="card-scroll" />
      <ng-content />
    </view>
  `,
})
export class ObservedCard {}

/** A bar written straight into the root component's template, with nothing around it. */
@Component({
  selector: 'x-top-bar',
  imports: [Pressable],
  template: `<pressable testID="top-action" />`,
})
export class TopBar {}

/** Every kind of touchable, a scroll view and a list, each logging its own presses. */
@Component({
  selector: 'x-interaction-observer',
  imports: [
    ObservedButton,
    ObservedCard,
    Pressable,
    ScrollView,
    Text,
    TopBar,
    TouchableOpacity,
    View,
    VirtualList,
  ],
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
      <x-observed-card><pressable testID="projected" /></x-observed-card>
    </scroll-view>
    <x-top-bar />
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
