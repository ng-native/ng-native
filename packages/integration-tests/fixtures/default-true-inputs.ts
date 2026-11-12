import { Component, signal, viewChild } from '@angular/core';
import { KeyboardAvoidingView } from '../../components/src/keyboard-avoiding-view.ts';
import { Pressable } from '../../components/src/pressable.ts';
import { SafeAreaProvider } from '../../components/src/safe-area-provider.ts';
import { Text } from '../../components/src/text.ts';
import { UiDropdownMenuItem, UiSegmentedButton } from '../../expo/src/expo-ui-components.ts';

/** Every boolean input whose default is true, bound to `on`, beside one left unbound. */
@Component({
  selector: 'x-default-true-inputs',
  imports: [
    KeyboardAvoidingView,
    Pressable,
    SafeAreaProvider,
    Text,
    UiDropdownMenuItem,
    UiSegmentedButton,
  ],
  template: `
    <safe-area-provider [reportInsets]="on()">
      <keyboard-avoiding-view [enabled]="on()">
        <pressable [cancelable]="on()"><text>Row</text></pressable>
        <ui-segmented-button nativeID="segment" [enabled]="on()" />
        <ui-dropdown-menu-item nativeID="item" [enabled]="on()" />
        <ui-segmented-button nativeID="unbound" />
      </keyboard-avoiding-view>
    </safe-area-provider>
  `,
})
export class DefaultTrueInputs {
  readonly on = signal<boolean | null | undefined>(true);
  readonly provider = viewChild.required(SafeAreaProvider);
  readonly avoiding = viewChild.required(KeyboardAvoidingView);
  readonly pressable = viewChild.required(Pressable);
  readonly segment = viewChild.required(UiSegmentedButton);
  readonly item = viewChild.required(UiDropdownMenuItem);
}
