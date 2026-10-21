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
        [backgroundColor]="background()"
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
  readonly background = signal<string | undefined>(undefined);
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

/** A sheet coloured by CSS: a class, a token that follows the colour scheme, and inline style. */
@Component({
  selector: 'expo-ui-bottom-sheet-styled',
  imports: [UiBottomSheet],
  template: `
    <ui-bottom-sheet
      [(open)]="open"
      [class]="classes()"
      [style.background-color]="inline()"
      [backgroundColor]="background()"
    >
      <text>Body</text>
    </ui-bottom-sheet>
  `,
  styles: `
    .surface {
      --surface: light-dark(#ffffff, #1c1c1e);
      background-color: var(--surface);
    }
    .warning {
      background-color: orange;
    }
  `,
})
export class ExpoUiBottomSheetStyledFixture {
  readonly open = signal(true);
  readonly classes = signal('surface');
  readonly inline = signal<string | undefined>(undefined);
  readonly background = signal<string | undefined>(undefined);
}
