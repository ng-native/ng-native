import { Component, Directive, ElementRef, signal, viewChild } from '@angular/core';
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

/** A component on a plain element, matched by an attribute: named by its selector. */
@Component({
  selector: 'section[x-attribute-card]',
  imports: [Pressable],
  template: `<pressable testID="attribute-action" />`,
})
export class AttributeCard {}

/** One of several selectors: named by the one for the element it is on. */
@Component({
  selector: 'x-tile, article[x-tile].wide',
  imports: [Pressable],
  template: `<pressable testID="tile-action" />`,
})
export class Tile {}

/** A pressable inside an iframe, which web-compat keeps a plain view. */
@Component({
  selector: 'x-framed-card',
  imports: [Pressable],
  template: `<iframe><pressable testID="in-frame" /></iframe>`,
})
export class FramedCard {}

/** A note matched by an attribute's value, and not where it is hidden. */
@Component({
  selector: 'aside[x-note=warn]:not(.hidden)',
  imports: [Pressable],
  template: `<pressable testID="note-action" />`,
})
export class Note {}

/** A component on an input, which web-compat makes a plain view while it is a checkbox. */
@Component({
  selector: 'input[x-check]',
  imports: [Pressable],
  template: `<pressable testID="in-check" />`,
})
export class Check {}

/** The framed card, in an app of its own: it is only a known element where web-compat is. */
@Component({
  selector: 'x-framed',
  imports: [Check, FramedCard, Note, View],
  template: `
    <view>
      <x-framed-card />
      <aside x-note="warn"></aside>
      <input x-check [type]="checkType()" />
    </view>
  `,
})
export class FramedFixture {
  readonly checkType = signal('checkbox');
}

/** Every kind of touchable, a scroll view and a list, each logging its own presses. */
@Component({
  selector: 'x-interaction-observer',
  imports: [
    AttributeCard,
    ObservedButton,
    ObservedCard,
    Pressable,
    ScrollView,
    Text,
    Tile,
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
      <section x-attribute-card></section>
      <article x-tile class="wide"></article>
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
