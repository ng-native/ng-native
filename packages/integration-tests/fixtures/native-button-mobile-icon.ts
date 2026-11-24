import { Component, signal } from '@angular/core';
import { NativeButton, type ButtonIcon } from '../../components/src/native-button.ts';

/** Lucide's `plus`, as `@ng-icons/lucide` exports it. */
export const plus =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M5 12h14" /><path d="m12 5v14" /></svg>';

@Component({
  selector: 'x-native-button-mobile-icon',
  imports: [NativeButton],
  template: `
    <native-button testID="add" [icon]="icon()" [style.color]="colour()">Add</native-button>
    <native-button testID="drawn" drawable="ic_star">Star</native-button>
    <native-button testID="plain">OK</native-button>
  `,
})
export class NativeButtonMobileIconFixture {
  readonly icon = signal<ButtonIcon | undefined>({ svg: plus });
  readonly colour = signal<string | undefined>(undefined);
}
