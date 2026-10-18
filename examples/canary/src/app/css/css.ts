import { Component } from '@angular/core';
import { ScrollView, Text } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { CssDemo } from './css-demo.ts';
import { page } from '../screen-styles.ts';

@Component({
  selector: 'x-css-page',
  imports: [NativeHeader, ScrollView, CssDemo, Text],
  template: `
    <native-header title="CSS" />
    <scroll-view class="screen" [contentContainerStyle]="page.content">
      <text class="hint">
        Everything below is styled by a styles: block. No bound style objects.
      </text>
      <x-css-demo />
    </scroll-view>
  `,
})
export class CssPage {
  protected readonly page = page;
}
