import { Component } from '@angular/core';
import { ExpoSymbol } from '../../expo/src/symbol.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

@Component({
  selector: 'x-platform-color',
  imports: [ExpoSymbol, Text, View],
  template: `
    <view>
      <text nativeID="label">system</text>
      <expo-symbol nativeID="symbol" name="star" />
    </view>
  `,
  styles: `
    #label {
      color: platform-color(label);
    }
    #symbol {
      tint-color: platform-color(link);
    }
  `,
})
export class PlatformColorHost {}
