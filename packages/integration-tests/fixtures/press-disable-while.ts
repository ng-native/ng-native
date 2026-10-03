import { Component, inject, input, signal } from '@angular/core';
import { PressBehavior } from '../../components/src/pressable.ts';
import { Text } from '../../components/src/text.ts';

/**
 * A button of an app's own, pressable through `PressBehavior`, that refuses presses while it is
 * loading: its own state, which a caller's `disabled` knows nothing of.
 */
@Component({
  selector: 'x-loading-button',
  imports: [Text],
  template: `<text>Save</text>`,
  hostDirectives: [{ directive: PressBehavior, inputs: ['disabled'], outputs: ['press'] }],
  styles: `
    :host {
      opacity: 1;
    }
    :host([data-disabled]) {
      opacity: 0.5;
    }
  `,
})
export class LoadingButton {
  readonly loading = input(false);

  constructor() {
    inject(PressBehavior).disableWhile(this.loading);
  }
}

@Component({
  selector: 'x-loading-host',
  imports: [LoadingButton],
  template: `
    <x-loading-button
      testID="button"
      [loading]="loading()"
      [disabled]="disabled()"
      (press)="presses.set(presses() + 1)"
    />
  `,
})
export class LoadingHost {
  readonly loading = signal(false);
  readonly disabled = signal<boolean | undefined>(undefined);
  readonly presses = signal(0);
}
