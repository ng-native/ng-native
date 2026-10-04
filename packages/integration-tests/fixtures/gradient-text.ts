import { Component, signal } from '@angular/core';
import { GradientText } from '../../components/src/gradient-text.ts';
import { Text } from '../../components/src/text.ts';

@Component({
  selector: 'x-gradient-text-host',
  imports: [GradientText, Text],
  template: `
    <gradient-text nativeID="mark" [class]="look()">
      {{ word() }} <text class="em">now</text>
    </gradient-text>
    <gradient-text nativeID="named" accessibilityLabel="Brand">Wk</gradient-text>
    <gradient-text nativeID="aria" aria-label="Logo">Wk</gradient-text>
    <text nativeID="plain" class="brand">Week</text>
    <gradient-text nativeID="inline" [style.background-color]="tint()">Tinted</gradient-text>
  `,
  styles: `
    .brand {
      background-image: linear-gradient(to bottom, red, blue);
      background-clip: text;
      -webkit-background-clip: text;
      color: transparent;
      font-size: 34px;
    }
    .warm {
      background-image: linear-gradient(to right, yellow, red);
      font-size: 20px;
    }
    .em {
      font-style: italic;
    }
  `,
})
export class GradientTextHost {
  readonly look = signal<string>('brand');
  readonly word = signal('Week');
  readonly tint = signal<string | null>('rgb(0, 128, 0)');
}
