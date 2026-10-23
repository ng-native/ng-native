import { Component, signal } from '@angular/core';
import { UiButton, UiHost, UiText, type UiModifier } from '../../expo/src/expo-ui-components.ts';

const DISABLED: readonly UiModifier[] = [{ $type: 'disabled', disabled: true }];
const ENABLED: readonly UiModifier[] = [{ $type: 'disabled', disabled: false }];

/**
 * `@expo/ui` buttons as an app writes them: one labelled by `label`, one by the text inside it, one
 * with SwiftUI's `destructive` role, and one SwiftUI's `disabled` modifier turns off. Save also
 * listens for Compose's own event, as an app can.
 */
@Component({
  selector: 'x-testing-expo-ui-button',
  imports: [UiButton, UiHost, UiText],
  template: `
    <ui-host [matchContents]="true">
      <ui-button
        label="Save"
        [modifiers]="enabled"
        (buttonPress)="saved.set(saved() + 1)"
        (buttonPressed)="composed.set(composed() + 1)"
      />
      <ui-button (buttonPress)="shared.set(shared() + 1)"><ui-text text="Share" /></ui-button>
      <ui-button label="Delete" role="destructive" (buttonPress)="deleted.set(deleted() + 1)" />
      <ui-button label="Send" [modifiers]="disabled" (buttonPress)="sent.set(sent() + 1)" />
    </ui-host>
  `,
})
export class TestingExpoUiButtonFixture {
  protected readonly disabled = DISABLED;
  protected readonly enabled = ENABLED;
  readonly saved = signal(0);
  readonly composed = signal(0);
  readonly shared = signal(0);
  readonly deleted = signal(0);
  readonly sent = signal(0);
}
