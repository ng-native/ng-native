/**
 * Fixture for `browser/touchable-opacity.test.ts`: a `<touchable-opacity>` given its resting
 * opacity by a class, by an inline `[style]` and by a bound `[style.opacity]`.
 */
import { Component } from '@angular/core';
import { Text, TouchableOpacity, View } from '@ng-native/components';

@Component({
  selector: 'app-root',
  imports: [Text, TouchableOpacity, View],
  styles: '.half { opacity: 0.5; }',
  template: `
    <view>
      <touchable-opacity id="class" class="half"><text>class</text></touchable-opacity>
      <touchable-opacity id="map" [style]="{ opacity: 0.5 }" [activeOpacity]="0.3">
        <text>map</text>
      </touchable-opacity>
      <touchable-opacity id="bound" [style.opacity]="0.5"><text>bound</text></touchable-opacity>
    </view>
  `,
})
export class TouchableOpacityApp {}
