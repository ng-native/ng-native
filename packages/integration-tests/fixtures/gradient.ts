import { Component } from '@angular/core';
import { View } from '../../components/src/view.ts';

@Component({
  selector: 'x-gradient-host',
  imports: [View],
  template: `<view nativeID="hero"></view>`,
  styles: `
    #hero {
      background-image: linear-gradient(to bottom right, red, blue 60%);
    }
  `,
})
export class GradientHost {}

@Component({
  selector: 'x-themed-gradient',
  imports: [View],
  template: `<view nativeID="themed"></view>`,
  styles: `
    #themed {
      background-image: linear-gradient(to right, var(--start), var(--middle) 50%, var(--end));
    }
  `,
})
export class ThemedGradient {}

@Component({
  selector: 'x-fading-gradients',
  imports: [View],
  template: `
    <view nativeID="first"></view>
    <view nativeID="last"></view>
    <view nativeID="red"></view>
    <view nativeID="middle"></view>
    <view nativeID="black"></view>
    <view nativeID="run"></view>
    <view nativeID="placed"></view>
    <view nativeID="zero"></view>
    <view nativeID="token"></view>
    <view nativeID="mix"></view>
    <view nativeID="bound" [style.--tint]="'white'"></view>
    <view nativeID="hsl" class="tinted" [style.--tint]="'hsl(0 100% 50%)'"></view>
    <view nativeID="veil"></view>
    <view nativeID="through"></view>
    <view nativeID="points"></view>
    <view nativeID="veilToken"></view>
    <view nativeID="even"></view>
    <view nativeID="faint"></view>
    <view nativeID="plateau"></view>
    <view nativeID="fromStart"></view>
    <view nativeID="mixed"></view>
    <view nativeID="mixedVeil"></view>
    <view nativeID="hard"></view>
  `,
  styles: `
    #first {
      background-image: linear-gradient(transparent, white);
    }
    #last {
      background-image: linear-gradient(white, transparent);
    }
    #red {
      background-image: linear-gradient(transparent, red);
    }
    #middle {
      background-image: linear-gradient(red, transparent, blue);
    }
    #black {
      background-image: linear-gradient(red, transparent, black);
    }
    #run {
      background-image: linear-gradient(red, transparent 20%, transparent 80%, blue);
    }
    #placed {
      background-image: linear-gradient(red, transparent 30%, blue 60%, lime);
    }
    #zero {
      background-image: linear-gradient(rgb(255 0 0 / 0), blue);
    }
    #token {
      background-image: linear-gradient(transparent, var(--surface));
    }
    #mix {
      background-image: linear-gradient(
        color-mix(in srgb, var(--surface) 0%, transparent),
        var(--surface)
      );
    }
    #veil {
      background-image: linear-gradient(rgb(0 0 0 / 0.1), white);
    }
    #through {
      background-image: linear-gradient(red, rgb(0 0 255 / 0.2), lime);
    }
    #points {
      background-image: linear-gradient(rgb(0 0 0 / 0.1) 20px, white 80px);
    }
    #veilToken {
      background-image: linear-gradient(var(--veil), var(--surface));
    }
    #even {
      background-image: linear-gradient(rgb(255 0 0 / 0.5), rgb(0 0 255 / 0.5));
    }
    #faint {
      background-image: linear-gradient(white, rgb(0 0 0 / 0.02));
    }
    #plateau {
      background-image: linear-gradient(red, rgb(0 0 255 / 0.2), rgb(0 0 255 / 0.2));
    }
    #fromStart {
      background-image: linear-gradient(rgb(0 0 0 / 0.1), white 80px);
    }
    #mixed {
      background-image: linear-gradient(red 20px, transparent, blue 80%);
    }
    #mixedVeil {
      background-image: linear-gradient(rgb(0 0 0 / 0.1) 20px, white 80%);
    }
    #hard {
      background-image: linear-gradient(red 50%, rgb(0 0 255 / 0.5) 50%);
    }
    #bound,
    .tinted {
      background-image: linear-gradient(transparent, var(--tint));
    }
  `,
})
export class FadingGradients {}
