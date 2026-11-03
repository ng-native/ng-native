import { Component, signal } from '@angular/core';
import { NativeHeader } from '../../router/src/native-header.ts';
import { NativeToolbar, NativeToolbarItem } from '../../router/src/native-toolbar.ts';

const template = `
  <native-header
    title="Inbox"
    [titleFontSize]="size()"
    [largeTitleFontSize]="size()"
    [backTitleFontSize]="size()"
  />
  <native-toolbar>
    <native-toolbar-item type="fixedSpacer" [width]="size()" />
  </native-toolbar>
`;

/** Every numeric router input bound to one value, a number to start with. */
@Component({
  selector: 'x-router-number-inputs',
  imports: [NativeHeader, NativeToolbar, NativeToolbarItem],
  template,
})
export class RouterNumberInputs {
  readonly size = signal<number | null | undefined>(12);
}

/** The same inputs bound to `null` from the first pass. */
@Component({
  selector: 'x-router-number-inputs-null',
  imports: [NativeHeader, NativeToolbar, NativeToolbarItem],
  template,
})
export class RouterNumberInputsNull {
  readonly size = signal<number | null | undefined>(null);
}
