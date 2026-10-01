import { Component } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

@Component({
  selector: 'x-root-styled',
  imports: [Text, View],
  template: `
    <view class="screen">
      <text>styled</text>
    </view>
  `,
  styles: `
    :host {
      background-color: rgb(244, 239, 230);
      padding: 20px;
    }
    .screen {
      flex: 1;
    }
  `,
})
export class RootStyled {}

@Component({
  selector: 'x-root-bare',
  imports: [Text, View],
  template: `
    <view class="screen">
      <text>bare</text>
    </view>
  `,
  styles: `
    .screen {
      flex: 1;
    }
  `,
})
export class RootBare {}

@Component({
  selector: 'x-root-sized',
  imports: [Text],
  template: `<text>sized</text>`,
  styles: `
    :host {
      height: 300px;
    }
  `,
})
export class RootSized {}
