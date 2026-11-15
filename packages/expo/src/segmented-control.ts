/**
 * `<segmented-control>` with its props and its `change` event typed.
 *
 * The element is `NATIVE_VIEWS`' name for `@react-native-segmented-control/segmented-control`; this
 * only claims it so strict templates know its props. Each input goes straight to the node, and
 * `change` is an output for its type only: the element's own event is what arrives, as with the
 * `@expo/ui` components in `expo-ui-components.ts`.
 */
import { Component, input, output } from '@angular/core';
import type { ControlSize } from '@ng-native/device';
import type { NativeSyntheticEvent } from '@ng-native/fabric';
import { optionalBoolean, optionalNumber } from './transforms.ts';

/** The font the segments' titles are drawn in. */
export interface SegmentedControlFont {
  readonly color?: string;
  readonly fontSize?: number;
  readonly fontFamily?: string;
  readonly fontWeight?: string;
}

/** What the control sends when the user picks a segment. */
export type SegmentedControlChangeEvent = NativeSyntheticEvent<{
  readonly value: string;
  readonly selectedSegmentIndex: number;
}>;

@Component({
  selector: 'segmented-control',
  template: '',
  host: {
    '[values]': 'values()',
    '[controlSize]': 'controlSize()',
    '[selectedIndex]': 'selectedIndex()',
    '[enabled]': 'enabled()',
    '[momentary]': 'momentary()',
    '[tintColor]': 'tintColor()',
    '[backgroundColor]': 'backgroundColor()',
    '[fontStyle]': 'fontStyle()',
    '[activeFontStyle]': 'activeFontStyle()',
    '[apportionsSegmentWidthsByContent]': 'apportionsSegmentWidthsByContent()',
    '[accessibilityLabel]': 'accessibilityLabel()',
  },
})
export class SegmentedControl {
  readonly values = input<readonly string[]>();
  /** AppKit's control size on macOS, and UIKit's on iOS 26 and later. Ignored elsewhere. */
  readonly controlSize = input<ControlSize>();
  readonly selectedIndex = input<number>(undefined, { transform: optionalNumber });
  readonly enabled = input<boolean>(undefined, { transform: optionalBoolean });
  /** Segments do not stay selected: each is a button. */
  readonly momentary = input<boolean>(undefined, { transform: optionalBoolean });
  /** The selected segment's colour. */
  readonly tintColor = input<string>();
  readonly backgroundColor = input<string>();
  readonly fontStyle = input<SegmentedControlFont>();
  readonly activeFontStyle = input<SegmentedControlFont>();
  /** Each segment as wide as its title rather than all equal. */
  readonly apportionsSegmentWidthsByContent = input<boolean>(undefined, {
    transform: optionalBoolean,
  });
  readonly accessibilityLabel = input<string>();
  readonly change = output<SegmentedControlChangeEvent>();
}
