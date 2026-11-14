import { Component, signal } from '@angular/core';
import { FormField, disabled, form, readonly, required } from '@angular/forms/signals';
/*
 * Through the barrel rather than file by file: a relative import of a decorated file is compiled
 * to its own .generated.ts module, a second copy of every class the primitives never see.
 */
import { TextInput, View } from '../../components/src/index.ts';

@Component({
  selector: 'x-text-input-form',
  imports: [FormField, TextInput, View],
  template: `
    <view>
      <text-input nativeID="email" [formField]="signUp.email" />

      <text-input
        nativeID="typed"
        placeholder="you@example.com"
        keyboardType="email-address"
        [secureTextEntry]="true"
        autoCapitalize="none"
        smartQuotes="false"
      />
      <text-input nativeID="notes" [multiline]="true" textAlignVertical="top" />
      <text-input nativeID="said-invalid" invalid touched />
      <text-input nativeID="said-valid" invalid="false" touched />
    </view>
  `,
})
export class TextInputForm {
  readonly locked = signal(false);
  readonly frozen = signal(false);
  readonly model = signal({ email: '' });
  readonly signUp = form(this.model, (path) => {
    required(path.email, { message: 'Email is required' });
    disabled(path.email, () => this.locked());
    readonly(path.email, () => this.frozen());
  });
}
