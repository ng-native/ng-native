import { Component, input, signal } from '@angular/core';
import { UiBottomSheet, type UiPresentationDetent } from '../../expo/src/expo-ui-components.ts';

// The class as this file's templates have it, for a test to provide its `SOURCE`.
export { UiBottomSheet };

/** An app's own component, as a sheet's content. */
@Component({
  selector: 'sheet-row',
  template: `<text>{{ label() }}</text>`,
})
export class SheetRow {
  readonly label = input('');
}

@Component({
  selector: 'expo-ui-bottom-sheet',
  imports: [UiBottomSheet, SheetRow],
  template: `
    <view
      (isPresentedChange)="heard.set(heard() + 1)"
      (dismiss)="heard.set(heard() + 1)"
      (dismissRequest)="heard.set(heard() + 1)"
    >
      <ui-bottom-sheet
        [(open)]="open"
        [fitToContents]="fit()"
        [detents]="detents()"
        [showDragIndicator]="grabber()"
        (dismissed)="dismissed.set(dismissed() + 1)"
      >
        <sheet-row testID="first" label="One" />
        <sheet-row testID="second" [label]="second()" />
      </ui-bottom-sheet>
    </view>
  `,
})
export class ExpoUiBottomSheetFixture {
  readonly open = signal(false);
  readonly fit = signal(false);
  readonly grabber = signal(true);
  readonly detents = signal<readonly UiPresentationDetent[] | undefined>(undefined);
  readonly second = signal('Two');
  readonly dismissed = signal(0);
  /** The sheet's native events, as a listener around it hears them. */
  readonly heard = signal(0);
}

/** Every option left as it is, and no listener. */
@Component({
  selector: 'expo-ui-bottom-sheet-defaults',
  imports: [UiBottomSheet],
  template: `<ui-bottom-sheet [(open)]="open" fitToContents><text>Body</text></ui-bottom-sheet>`,
})
export class ExpoUiBottomSheetDefaultsFixture {
  readonly open = signal(true);
}
