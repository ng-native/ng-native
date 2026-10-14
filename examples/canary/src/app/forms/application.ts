import { Component, inject, signal } from '@angular/core';
import { FormField, form, submit, type FieldTree } from '@angular/forms/signals';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from '@ng-native/components';
import { UiDatePicker, UiHost, UiPicker, type UiPickerOption } from '@ng-native/expo';
import { NativeHeader } from '@ng-native/router';
import {
  Usernames,
  applicationSchema,
  emptyApplication,
  type Application,
} from './application-form.ts';
import { FormRow } from './form-row.ts';

/**
 * A long form, as a sign-up or an insurance quote is: twenty-odd fields in sections, a date and
 * pickers, rules between fields, fields that come and go, a list of dependants the user adds to,
 * a username checked with the server as it is typed, and a submit that takes the user to the
 * first thing that needs fixing.
 */
@Component({
  selector: 'x-application',
  imports: [
    FormField,
    FormRow,
    NativeHeader,
    Pressable,
    ScrollView,
    Switch,
    Text,
    TextInput,
    UiDatePicker,
    UiHost,
    UiPicker,
    View,
  ],
  template: `
    <native-header title="Application" />
    <scroll-view
      class="screen"
      [contentContainerStyle]="content"
      [automaticallyAdjustKeyboardInsets]="true"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <text class="section">About you</text>
      <x-form-row label="First name" [field]="f.firstName">
        <text-input
          class="field"
          [formField]="f.firstName"
          accessibilityLabel="First name"
          textContentType="givenName"
          autoComplete="given-name"
          returnKeyType="next"
          (submitEditing)="next(f.lastName)"
        />
      </x-form-row>
      <x-form-row label="Last name" [field]="f.lastName">
        <text-input
          class="field"
          [formField]="f.lastName"
          accessibilityLabel="Last name"
          textContentType="familyName"
          autoComplete="family-name"
          returnKeyType="next"
          (submitEditing)="next(f.email)"
        />
      </x-form-row>
      <x-form-row label="Email" [field]="f.email">
        <text-input
          class="field"
          [formField]="f.email"
          accessibilityLabel="Email"
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          autoCapitalize="none"
          [autoCorrect]="false"
          returnKeyType="next"
          (submitEditing)="next(f.phone)"
        />
      </x-form-row>
      <x-form-row label="Phone (optional)" [field]="f.phone">
        <text-input
          class="field"
          [formField]="f.phone"
          accessibilityLabel="Phone"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          returnKeyType="next"
          (submitEditing)="next(f.line1)"
        />
      </x-form-row>
      <x-form-row label="Date of birth" [field]="f.born">
        <!-- Its height only: Compose's picker scrolls sideways, and crashes at a width with no limit. -->
        <ui-host [matchContents]="{ vertical: true }">
          <ui-date-picker
            title="Born"
            accessibilityLabel="Date of birth"
            [displayedComponents]="dateOnly"
            [formField]="f.born"
          />
        </ui-host>
      </x-form-row>

      <text class="section">Address</text>
      <x-form-row label="Country" [field]="f.country">
        <ui-host [matchContents]="true">
          <ui-picker
            label="Country"
            pickerStyle="menu"
            [options]="countries"
            [formField]="f.country"
          />
        </ui-host>
      </x-form-row>
      <x-form-row label="Address line 1" [field]="f.line1">
        <text-input
          class="field"
          [formField]="f.line1"
          accessibilityLabel="Address line 1"
          textContentType="streetAddressLine1"
          autoComplete="address-line1"
          returnKeyType="next"
          (submitEditing)="next(f.line2)"
        />
      </x-form-row>
      <x-form-row label="Address line 2 (optional)" [field]="f.line2">
        <text-input
          class="field"
          [formField]="f.line2"
          accessibilityLabel="Address line 2"
          textContentType="streetAddressLine2"
          autoComplete="address-line2"
          returnKeyType="next"
          (submitEditing)="next(f.city)"
        />
      </x-form-row>
      <x-form-row label="Town or city" [field]="f.city">
        <text-input
          class="field"
          [formField]="f.city"
          accessibilityLabel="Town or city"
          textContentType="addressCity"
          autoComplete="address-level2"
          returnKeyType="next"
          (submitEditing)="next(f.postcode)"
        />
      </x-form-row>
      @if (!f.state().hidden()) {
        <x-form-row label="State" [field]="f.state">
          <ui-host [matchContents]="true">
            <ui-picker label="State" pickerStyle="menu" [options]="states" [formField]="f.state" />
          </ui-host>
        </x-form-row>
      }
      <x-form-row [label]="postcodeLabel()" [field]="f.postcode">
        <text-input
          class="field"
          [formField]="f.postcode"
          [accessibilityLabel]="postcodeLabel()"
          [keyboardType]="data().country === 'US' ? 'number-pad' : 'default'"
          textContentType="postalCode"
          autoComplete="postal-code"
          autoCapitalize="characters"
          returnKeyType="next"
          (submitEditing)="next(f.username)"
        />
      </x-form-row>

      <text class="section">Account</text>
      <x-form-row label="Username" [field]="f.username" hint="Letters, numbers and underscores">
        <text-input
          class="field"
          [formField]="f.username"
          accessibilityLabel="Username"
          textContentType="username"
          autoComplete="username"
          autoCapitalize="none"
          [autoCorrect]="false"
          returnKeyType="next"
          (submitEditing)="next(f.password)"
        />
      </x-form-row>
      <x-form-row label="Password" [field]="f.password" hint="At least 8 characters">
        <text-input
          class="field"
          [formField]="f.password"
          accessibilityLabel="Password"
          [secureTextEntry]="true"
          textContentType="newPassword"
          autoComplete="new-password"
          passwordRules="minlength: 8;"
          returnKeyType="next"
          (submitEditing)="next(f.confirm)"
        />
      </x-form-row>
      <x-form-row label="Confirm password" [field]="f.confirm">
        <text-input
          class="field"
          [formField]="f.confirm"
          accessibilityLabel="Confirm password"
          [secureTextEntry]="true"
          textContentType="newPassword"
          returnKeyType="done"
        />
      </x-form-row>

      <text class="section">Preferences</text>
      <view class="toggle-row">
        <text class="body">Newsletter</text>
        <switch [formField]="f.newsletter" accessibilityLabel="Newsletter" />
      </view>
      @if (!f.frequency().hidden()) {
        <x-form-row label="How often" [field]="f.frequency">
          <ui-host [matchContents]="true">
            <ui-picker
              label="How often"
              pickerStyle="segmented"
              [options]="frequencies"
              [formField]="f.frequency"
            />
          </ui-host>
        </x-form-row>
      }
      <view class="toggle-row">
        <view class="toggle-text">
          <text class="body">Text messages</text>
          @if (f.sms().disabled()) {
            <text class="hint">Add a phone number to turn these on</text>
          }
        </view>
        <switch [formField]="f.sms" accessibilityLabel="Text messages" />
      </view>

      <text class="section">Dependants</text>
      @for (dependant of f.dependants; track dependant; let i = $index) {
        <view class="card dependant">
          <x-form-row [label]="'Dependant ' + (i + 1)" [field]="dependant.name">
            <text-input
              class="field"
              [formField]="dependant.name"
              [accessibilityLabel]="'Dependant ' + (i + 1) + ' name'"
              textContentType="name"
            />
          </x-form-row>
          <x-form-row label="Their date of birth" [field]="dependant.born">
            <ui-host [matchContents]="{ vertical: true }">
              <ui-date-picker
                title="Born"
                [displayedComponents]="dateOnly"
                [formField]="dependant.born"
              />
            </ui-host>
          </x-form-row>
          <pressable
            accessibilityRole="button"
            [accessibilityLabel]="'Remove dependant ' + (i + 1)"
            (press)="removeDependant(i)"
          >
            <text class="danger">Remove</text>
          </pressable>
        </view>
      }
      <pressable class="card" accessibilityRole="button" (press)="addDependant()">
        <text class="button-label">Add a dependant</text>
      </pressable>

      <text class="section">About</text>
      <x-form-row label="A few words about you" [field]="f.bio" [hint]="bioCount()">
        <text-input
          class="field bio"
          [formField]="f.bio"
          accessibilityLabel="About you"
          [multiline]="true"
        />
      </x-form-row>
      <x-form-row label="Terms" [field]="f.terms">
        <view class="toggle-row">
          <text class="body">I accept the terms</text>
          <switch [formField]="f.terms" accessibilityLabel="I accept the terms" />
        </view>
      </x-form-row>

      <pressable
        class="button"
        accessibilityRole="button"
        [disabled]="f().submitting()"
        (press)="send()"
      >
        <text class="button-label">{{ f().submitting() ? 'Sending' : 'Apply' }}</text>
      </pressable>
      @if (sent()) {
        <text class="body success" accessibilityRole="alert">Application sent.</text>
      }
    </scroll-view>
  `,
  styles: `
    .section {
      color: var(--text-strong);
      font-size: 20px;
      font-weight: 700;
      margin-top: 12px;
    }
    .toggle-row {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .toggle-text {
      flex: 1;
    }
    .dependant {
      align-items: stretch;
      gap: 10px;
    }
    .bio {
      min-height: 88px;
    }
  `,
})
export class ApplicationPage {
  private readonly usernames = inject(Usernames);

  protected readonly content = { padding: 20, gap: 14 };
  protected readonly dateOnly = ['date'] as const;
  protected readonly countries: UiPickerOption[] = [
    { value: 'GB', label: 'United Kingdom' },
    { value: 'US', label: 'United States' },
    { value: 'IE', label: 'Ireland' },
  ];
  protected readonly states: UiPickerOption[] = ['', 'CA', 'NY', 'TX', 'WA'].map((value) => ({
    value,
    label: value || 'Choose',
  }));
  protected readonly frequencies: UiPickerOption[] = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
  ];

  readonly data = signal<Application>(emptyApplication());
  readonly f = form(this.data, applicationSchema(this.usernames));
  protected readonly sent = signal(false);

  protected postcodeLabel(): string {
    return this.data().country === 'US' ? 'ZIP code' : 'Postcode';
  }

  protected bioCount(): string {
    return `${this.data().bio.length} of 280`;
  }

  /** Move to the next field, as the keyboard's Next key does. */
  protected next(field: FieldTree<unknown>): void {
    field().focusBoundControl();
  }

  protected addDependant(): void {
    this.data.update((data) => ({
      ...data,
      dependants: [...data.dependants, { name: '', born: null }],
    }));
  }

  protected removeDependant(index: number): void {
    this.data.update((data) => ({
      ...data,
      dependants: data.dependants.filter((_, at) => at !== index),
    }));
  }

  /** Send it, or take the user to the first field that needs fixing. */
  protected async send(): Promise<void> {
    this.sent.set(false);
    const ok = await submit(this.f, async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return undefined;
    });
    if (ok) {
      this.sent.set(true);
      return;
    }
    this.firstToFix()?.().focusBoundControl();
  }

  /**
   * The first field with an error, in the order the screen shows them. `errorSummary()` lists
   * errors in its own order (the last field's first), and a field has no public position, so the
   * order is written down here.
   */
  private firstToFix(): FieldTree<unknown> | undefined {
    const f = this.f;
    const order: FieldTree<unknown>[] = [
      f.firstName,
      f.lastName,
      f.email,
      f.phone,
      f.born,
      f.country,
      f.line1,
      f.line2,
      f.city,
      f.state,
      f.postcode,
      f.username,
      f.password,
      f.confirm,
      f.newsletter,
      f.frequency,
      f.sms,
      ...[...f.dependants].flatMap((dependant) => [dependant.name, dependant.born]),
      f.bio,
      f.terms,
    ];
    return order.find((field) => field().invalid() && !field().hidden());
  }
}
