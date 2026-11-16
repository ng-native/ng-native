import { Component, signal } from '@angular/core';
import { Modal } from '../../components/src/modal.ts';
import { Pressable } from '../../components/src/pressable.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

@Component({
  selector: 'x-modal-anchor',
  imports: [Modal, Pressable, Text, View],
  template: `
    <view testID="target" #target></view>
    <pressable testID="button" #button><text>Open</text></pressable>
    <modal testID="pop" [anchor]="other() ?? (useButton() ? button : anchored() ? target : null)">
      <text>Popover</text>
    </modal>
    <modal testID="sheet"><text>Sheet</text></modal>
  `,
})
export class ModalAnchorFixture {
  readonly anchored = signal(true);
  readonly useButton = signal(false);
  /** An anchor a test makes itself, such as a node not yet committed. */
  readonly other = signal<unknown>(null);
}
