import { Component, signal, viewChild } from '@angular/core';
import { Image } from '../../components/src/image.ts';
import { KeyboardAvoidingView } from '../../components/src/keyboard-avoiding-view.ts';
import { Modal } from '../../components/src/modal.ts';
import { Pressable } from '../../components/src/pressable.ts';
import { RefreshControl } from '../../components/src/refresh-control.ts';
import { ScrollView } from '../../components/src/scroll-view.ts';
import { Switch } from '../../components/src/switch.ts';
import { Text } from '../../components/src/text.ts';
import { TextInput } from '../../components/src/text-input.ts';
import { View } from '../../components/src/view.ts';
import { VirtualList } from '../../components/src/virtual-list.ts';

@Component({
  selector: 'x-press-timing',
  imports: [Pressable, Text],
  template: `
    <pressable
      nativeID="btn"
      [delayLongPress]="60"
      [minPressDuration]="40"
      [delayPressIn]="delayIn()"
      (pressIn)="log.push('in')"
      (pressOut)="log.push('out')"
      (press)="log.push('press')"
      (longPress)="log.push('long')"
    >
      <text>hold me</text>
    </pressable>
  `,
})
export class PressTiming {
  readonly log: string[] = [];
  readonly delayIn = signal(0);
}

@Component({
  selector: 'x-text-press',
  imports: [Text],
  template: `
    <text nativeID="plain" (press)="log.push('plain')">plain</text>
    <text nativeID="link" pressable (press)="log.push('link')">link</text>
  `,
})
export class TextPress {
  readonly log: string[] = [];
}

@Component({
  selector: 'x-input-form',
  imports: [TextInput],
  template: `
    <text-input nativeID="single" [(value)]="draft" (changeText)="log.push($event)" />
    <text-input nativeID="multi" multiline [scrollEnabled]="false" [(value)]="notes" />
    <text-input nativeID="forced" submitBehavior="newline" [(value)]="notes" />
  `,
})
export class InputForm {
  readonly draft = signal('');
  readonly notes = signal('');
  readonly log: string[] = [];
  readonly single = viewChild.required(TextInput);
}

@Component({
  selector: 'x-refresh',
  imports: [ScrollView, RefreshControl, Text],
  template: `
    <scroll-view>
      <refresh-control [(refreshing)]="refreshing" (refresh)="log.push('refresh')" />
      <text>content</text>
    </scroll-view>
  `,
})
export class Refresh {
  readonly refreshing = signal(false);
  readonly log: string[] = [];
}

@Component({
  selector: 'x-horizontal-scroll',
  imports: [ScrollView, Text, View],
  template: `
    <scroll-view nativeID="sideways" [horizontal]="true" [contentContainerStyle]="{ padding: 8 }">
      <view nativeID="wide"><text>wide</text></view>
    </scroll-view>
    <scroll-view nativeID="upright">
      <view><text>tall</text></view>
    </scroll-view>
  `,
})
export class HorizontalScroll {}

@Component({
  selector: 'x-keyboard-taps',
  imports: [ScrollView, TextInput, View, Text, Pressable],
  template: `
    <scroll-view nativeID="never">
      <text-input nativeID="field" />
      <view><text-input nativeID="next" /></view>
      <view nativeID="elsewhere"><text>tap here</text></view>
      <pressable nativeID="button" (press)="pressed.push('button')"><text>button</text></pressable>
    </scroll-view>
    <scroll-view nativeID="always" keyboardShouldPersistTaps="always">
      <text-input nativeID="field2" />
      <view nativeID="elsewhere2"><text>tap here</text></view>
    </scroll-view>
  `,
})
export class KeyboardTaps {
  readonly scroll = viewChild.required(ScrollView);
  readonly pressed: string[] = [];
}

/**
 * A list with a field above it: a chat's transcript and composer. The list takes the scroll view's
 * native props as bindings, as FlatList passes them through.
 */
@Component({
  selector: 'x-list-keyboard',
  imports: [TextInput, Text, View, VirtualList],
  template: `
    <text-input nativeID="composer" />
    <virtual-list
      #list
      nativeID="transcript"
      [items]="rows"
      [itemHeight]="40"
      [keyboardDismissMode]="dismiss()"
      [keyboardShouldPersistTaps]="persist()"
      [showsVerticalScrollIndicator]="false"
      [contentInset]="{ top: 0, bottom: 20, left: 0, right: 0 }"
      [scrollIndicatorInsets]="{ top: 0, bottom: 20, left: 0, right: 0 }"
      [bounces]="false"
    >
      @for (row of list.window(); track row.slot) {
        <view [style]="row.style" [nativeID]="'message' + row.index"
          ><text>{{ row.item }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class ListKeyboard {
  readonly rows = Array.from({ length: 50 }, (_, i) => `message ${i}`);
  readonly dismiss = signal<'none' | 'on-drag' | 'interactive'>('interactive');
  readonly persist = signal<'always' | 'never' | 'handled'>('never');
}

@Component({
  selector: 'x-images',
  imports: [Image],
  template: `
    <image nativeID="alt" [source]="{ uri: 'a.png' }" alt="A picture" />
    <image
      nativeID="set"
      src="a.png"
      srcSet="a@2x.png 2x, a@3x.png 3x"
      crossOrigin="use-credentials"
    />
  `,
})
export class Images {}

@Component({
  selector: 'x-modals',
  imports: [Modal, Text],
  template: `
    <modal nativeID="clear" transparent><text>a</text></modal>
    <modal nativeID="sheet" presentationStyle="pageSheet"><text>b</text></modal>
    <modal nativeID="bars" navigationBarTranslucent><text>c</text></modal>
  `,
})
export class Modals {}

@Component({
  selector: 'x-avoiding',
  imports: [KeyboardAvoidingView, View, Text],
  template: `
    <keyboard-avoiding-view nativeID="pad" [keyboardVerticalOffset]="10">
      <text>padded</text>
    </keyboard-avoiding-view>
    <keyboard-avoiding-view nativeID="pos" behavior="position" [contentContainerStyle]="{ gap: 4 }">
      <text>moved</text>
    </keyboard-avoiding-view>
    <keyboard-avoiding-view nativeID="shrink" behavior="height">
      <text>shrunk</text>
    </keyboard-avoiding-view>
  `,
})
export class Avoiding {}

@Component({
  selector: 'x-listing',
  imports: [VirtualList, View, Text],
  template: `
    <virtual-list
      #list
      [items]="items()"
      [itemHeight]="10"
      [overscan]="0"
      (endReached)="ends.push($event.distanceFromEnd)"
    >
      <text listHeader>header</text>
      @for (row of list.window(); track row.index) {
        <view [style]="row.style"
          ><text>{{ row.item }}</text></view
        >
      }
      <text listFooter>footer</text>
    </virtual-list>
  `,
})
export class Listing {
  readonly items = signal(Array.from({ length: 100 }, (_, i) => `row ${i}`));
  readonly ends: number[] = [];
  readonly list = viewChild.required(VirtualList);
}

@Component({
  selector: 'x-switches',
  imports: [Switch],
  template: `
    <switch
      [(checked)]="on"
      disabled
      thumbColor="#fff"
      [trackColor]="{ false: '#000', true: '#0f0' }"
      ios_backgroundColor="#333"
    />
  `,
})
export class Switches {
  readonly on = signal(true);
}

/** Props and behaviours the other fixtures leave at their defaults. */
@Component({
  selector: 'x-odds',
  imports: [Image, Pressable, ScrollView, Text, TextInput, View],
  template: `
    <scroll-view nativeID="handled" keyboardShouldPersistTaps="handled">
      <text-input nativeID="field3" />
      <view><text-input nativeID="next3" /></view>
      <pressable nativeID="button3"><text>button</text></pressable>
      <view nativeID="elsewhere3"><text>tap here</text></view>
    </scroll-view>
    <scroll-view nativeID="fast" decelerationRate="fast" />
    <view id="card" testID="card-test"></view>
    <image nativeID="both" src="a.png" srcSet="a.png 1x, a@2x.png 2x" />
    <image
      nativeID="headed"
      [source]="{ uri: 'h.png', headers: { Authorization: 'token' } }"
      crossOrigin="use-credentials"
    />
    <text nativeID="off" pressable [disabled]="true" (press)="log.push('off')">off</text>
  `,
})
export class Odds {
  readonly log: string[] = [];
  readonly input = viewChild.required(TextInput);
}
