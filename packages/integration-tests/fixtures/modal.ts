import { Component, signal } from '@angular/core';
import { Image } from '../../components/src/image.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';
import { Modal } from '../../components/src/modal.ts';
import { Pressable } from '../../components/src/pressable.ts';

@Component({
  selector: 'x-modal',
  imports: [Modal, Image, Text, View],
  template: `
    <view>
      <modal [visible]="open()"><text>solid</text></modal>
      <modal [visible]="open()" [transparent]="true"><text>see-through</text></modal>
      <image [source]="local" />
      <image [source]="remote" />
    </view>
  `,
})
export class ModalHost {
  open = signal(true);
  // Stands in for require('./x.png'), which Metro compiles to an asset id.
  local = 42;
  remote = { uri: 'https://example.invalid/x.png' };
}

@Component({
  selector: 'x-hidden-modal',
  imports: [Modal, Pressable, Text, View],
  template: `
    <view>
      <modal [visible]="open()" (dismiss)="countDismissal()">
        <pressable (press)="presses = presses + 1"><text>sheet</text></pressable>
      </modal>
      <text>screen</text>
    </view>
  `,
})
export class HiddenModal {
  open = signal(false);
  dismissed = 0;
  presses = 0;

  countDismissal(): void {
    this.dismissed++;
  }
}
