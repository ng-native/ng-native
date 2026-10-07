import { Component, signal } from '@angular/core';
import {
  UiBottomSheet,
  UiButton,
  UiHost,
  UiNavigationStack,
  UiSlot,
  UiText,
  UiToolbar,
  UiToolbarItem,
} from '../../expo/src/expo-ui-components.ts';

// The class as this file's templates have it, for a test to provide its `SOURCE`.
export { UiBottomSheet };

/** A toolbar written out by hand, as SwiftUI content inside a host. */
@Component({
  selector: 'expo-ui-toolbar',
  imports: [UiButton, UiHost, UiNavigationStack, UiSlot, UiText, UiToolbar, UiToolbarItem],
  template: `
    <ui-host>
      <ui-navigation-stack>
        <ui-toolbar>
          <ui-text>Birds</ui-text>
          <ui-slot name="content">
            <ui-toolbar-item placement="topBarTrailing">
              <ui-button role="close" />
            </ui-toolbar-item>
            <ui-toolbar-item>
              <ui-button label="Share" />
            </ui-toolbar-item>
          </ui-slot>
        </ui-toolbar>
      </ui-navigation-stack>
    </ui-host>
  `,
})
export class ExpoUiToolbarFixture {}

/** A sheet whose close button is the system's own, in its toolbar. */
@Component({
  selector: 'expo-ui-sheet-toolbar',
  imports: [UiBottomSheet, UiButton, UiToolbarItem],
  template: `
    <ui-bottom-sheet [(open)]="open" [fitToContents]="fit()">
      @if (closable()) {
        <ui-toolbar-item placement="cancellationAction">
          <ui-button testID="close" role="close" (buttonPress)="open.set(false)" />
        </ui-toolbar-item>
      }
      <text testID="body">Body</text>
    </ui-bottom-sheet>
  `,
})
export class ExpoUiSheetToolbarFixture {
  readonly open = signal(true);
  readonly closable = signal(true);
  readonly fit = signal(false);
}
