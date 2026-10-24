import { Component, signal } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { TouchableOpacity } from '../../components/src/touchable-opacity.ts';
import { View } from '../../components/src/view.ts';

/** A `<touchable-opacity>` given its resting opacity each way a caller can give one. */
@Component({
  selector: 'x-touchable-resting',
  imports: [TouchableOpacity, Text, View],
  styles: `
    .half {
      opacity: 0.5;
    }
    .quarter {
      opacity: 0.25;
    }
  `,
  template: `
    <view>
      <touchable-opacity testID="class" [class]="dim()">
        <text>class</text>
      </touchable-opacity>
      <touchable-opacity testID="map" [style]="{ opacity: mapped() }">
        <text>map</text>
      </touchable-opacity>
      <touchable-opacity testID="bound" [style.opacity]="bound()">
        <text>bound</text>
      </touchable-opacity>
      <touchable-opacity testID="tailwind" class="opacity-50">
        <text>tailwind</text>
      </touchable-opacity>
      <touchable-opacity testID="active" [activeOpacity]="0.3" [style]="{ opacity: 0.5 }">
        <text>active</text>
      </touchable-opacity>
    </view>
  `,
})
export class TouchableResting {
  dim = signal('half');
  mapped = signal<number | undefined>(0.5);
  bound = signal<number | undefined>(0.5);
}
