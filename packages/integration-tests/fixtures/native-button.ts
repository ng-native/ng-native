import { Component, signal } from '@angular/core';
import { NativeButton } from '../../components/src/native-button.ts';

@Component({
  selector: 'x-native-button',
  imports: [NativeButton],
  template: `
    <native-button
      testID="delete"
      kind="destructive"
      controlSize="small"
      sfSymbol="trash"
      [disabled]="off()"
      (press)="presses.set(presses() + 1)"
      >Delete</native-button
    >
    <native-button testID="plain">OK</native-button>
    <native-button testID="symbol" [icon]="{ sfSymbol: 'star' }">Star</native-button>
    <native-button testID="drawn" drawable="ic_star">Star</native-button>
  `,
})
export class NativeButtonFixture {
  readonly off = signal(false);
  readonly presses = signal(0);
}
