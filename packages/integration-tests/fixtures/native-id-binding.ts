import { Component, input, signal } from '@angular/core';
import { PressBehavior } from '../../components/src/pressable.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

/** A row whose press behaviour exposes only `disabled`, not the identity inputs alongside it. */
@Component({
  selector: 'x-narrow-row',
  template: `<ng-content />`,
  hostDirectives: [{ directive: PressBehavior, inputs: ['disabled'], outputs: ['press'] }],
  host: { 'data-slot': 'narrow' },
})
export class NarrowRow {
  readonly label = input('');
}

/**
 * The other route to the same clobber: a host binding on the composing component, such as a
 * component setting `[accessible]` or `[accessibilityLabel]` through its own `host` object rather
 * than through an input of the class it composes in.
 */
@Component({
  selector: 'x-host-bound-row',
  template: `<ng-content />`,
  hostDirectives: [{ directive: PressBehavior, inputs: ['disabled'], outputs: ['press'] }],
  host: {
    'data-slot': 'host-bound',
    '[accessibilityLabel]': 'label()',
  },
})
export class HostBoundRow {
  readonly label = input('');
}

/** The same, with the identity inputs listed through explicitly alongside `disabled`. */
@Component({
  selector: 'x-wide-row',
  template: `<ng-content />`,
  hostDirectives: [
    {
      directive: PressBehavior,
      inputs: ['disabled', 'nativeID', 'id', 'testID'],
      outputs: ['press'],
    },
  ],
  host: { 'data-slot': 'wide' },
})
export class WideRow {
  readonly label = input('');
}

@Component({
  selector: 'x-native-id-host',
  imports: [HostBoundRow, NarrowRow, Text, View, WideRow],
  template: `
    <view>
      <x-narrow-row nativeID="narrow-static"><text>a</text></x-narrow-row>
      <x-narrow-row [nativeID]="bound()"><text>b</text></x-narrow-row>
      <x-wide-row nativeID="wide-static"><text>c</text></x-wide-row>
      <x-wide-row [nativeID]="boundWide()"><text>d</text></x-wide-row>

      <!-- The two extra conditions the report named: a bound disabled beside it, and a loop. -->
      <x-narrow-row [nativeID]="'narrow-both'" [disabled]="off()"><text>e</text></x-narrow-row>
      <x-host-bound-row nativeID="host-bound" [label]="'Close'" [disabled]="off()"
        ><text>f</text></x-host-bound-row
      >
      @for (row of rows(); track row) {
        <x-narrow-row [nativeID]="row" [disabled]="off()"
          ><text>{{ row }}</text></x-narrow-row
        >
      }
    </view>
  `,
})
export class NativeIdHost {
  readonly bound = signal('narrow-bound');
  readonly boundWide = signal('wide-bound');
  readonly off = signal(false);
  readonly rows = signal(['loop-one', 'loop-two']);
}
