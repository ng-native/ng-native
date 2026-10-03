---
title: Build a form
summary: Signal Forms over native controls, validated and submitted, with no adapter code.
---

# Build a form

## Install Signal Forms

Install `@angular/forms` at your app's exact `@angular/core` version, shown by
`npm ls @angular/core`. It is not a framework dependency. A mismatch causes `ERESOLVE` because
`@angular/forms` requires matching `@angular/core` and `@angular/common` peers:

```sh
npm install @angular/forms@<version>
```

Signal Forms binds directly to native control models: `form()` expects `value`, or `checked` for
boolean controls. `<text-input>` and `<switch>` expose these names. `@ng-native/components` uses
this contract rather than `ControlValueAccessor`, which it does not support and never will.

## Define the form

`form()` from `@angular/forms/signals` takes a data signal and a schema that adds validators to
field paths:

```ts
import { Component, signal } from '@angular/core';
import { FormField, form, minLength, required } from '@angular/forms/signals';
import { Switch, Text, TextInput, View } from '@ng-native/components';

@Component({
  selector: 'app-sign-up',
  imports: [FormField, TextInput, Switch, Text, View],
  template: `
    <view>
      <text-input placeholder="Name" [formField]="f.name" />
      @if (f.name().touched() && f.name().invalid()) {
        <text>{{ f.name().errors().length }} error(s)</text>
      }

      <view class="flex-row items-center gap-2">
        <switch [formField]="f.subscribed" />
        <text>Subscribe to updates</text>
      </view>
    </view>
  `,
})
export class SignUp {
  protected readonly data = signal({ name: '', subscribed: false });
  protected readonly f = form(this.data, (path) => {
    required(path.name);
    minLength(path.name, 3);
  });
}
```

`data` is the readable, writable state signal; `f` is its field tree, and `[formField]` binds a
control to a path.
`FormField`, `form`, `required` and `minLength` come from Angular's `@angular/forms/signals`.

Include `FormField` in the component's `imports`. Without it, `[formField]` compiles but has no
consumer: the control stays empty and the form invalid. This build does not run the browser
compiler's usual "Can't bind to 'formField'" check. Instead, development builds log the element and
missing import. The same applies to `ngModel` and Reactive Forms directives.

## Why no adapter class was needed

`<text-input>` exposes `value` as a `model<string>()`; `<switch>` exposes `checked` as a
`model<boolean>()`. These names let `FormField` provide two-way binding, disabled/readonly state
and touched-on-blur handling. See [Text input](/packages/components/input#the-signal-forms-contract)
for the mapping of `disabled()`/`readonly()` to `editable` and `invalid`/`touched` to
`data-invalid`/`data-touched` for CSS.

## Style invalid state

Style the `data-*` attributes published by `FormField` and the control, as with press-state
selectors:

```css
text-input {
  border-width: 1px;
  border-color: #3a3a42;
  border-radius: 8px;
  padding: 12px;
}
text-input[data-invalid][data-touched] {
  border-color: #ff6b6b;
}
```

## Submit the form

`submit()` runs your action only for a valid form and reports the outcome. Add a button, API call
and status display:

```ts
import { Component, signal } from '@angular/core';
import { FormField, form, minLength, required, submit } from '@angular/forms/signals';
import { Pressable, Switch, Text, TextInput, View } from '@ng-native/components';

/** Stands in for your own API call. Resolves false for a name that is already taken. */
async function createAccount(data: { name: string; subscribed: boolean }): Promise<boolean> {
  return data.name !== 'ada';
}

@Component({
  selector: 'app-sign-up',
  imports: [FormField, Pressable, TextInput, Switch, Text, View],
  template: `
    <view>
      <text-input placeholder="Name" [formField]="f.name" />
      @if (f.name().touched() && f.name().invalid()) {
        <text accessibilityRole="alert">{{ f.name().errors().length }} error(s)</text>
      }

      <view class="flex-row items-center gap-2">
        <switch [formField]="f.subscribed" />
        <text>Subscribe to updates</text>
      </view>

      <pressable accessibilityRole="button" [disabled]="f().submitting()" (press)="save()">
        <text>{{ f().submitting() ? 'Signing up…' : 'Sign up' }}</text>
      </pressable>

      @switch (status()) {
        @case ('success') {
          <text>You're signed up.</text>
        }
        @case ('error') {
          <text accessibilityRole="alert">Fix the errors above, then try again.</text>
        }
      }
    </view>
  `,
})
export class SignUp {
  protected readonly data = signal({ name: '', subscribed: false });
  protected readonly status = signal<'idle' | 'success' | 'error'>('idle');
  protected readonly f = form(this.data, (path) => {
    required(path.name);
    minLength(path.name, 3);
  });

  protected async save(): Promise<void> {
    await submit(this.f, {
      action: async () => {
        const created = await createAccount(this.data());
        if (!created) {
          return { kind: 'taken', message: 'That name is already taken.', fieldTree: this.f.name };
        }
        this.status.set('success');
        return;
      },
      onInvalid: () => this.status.set('error'),
    });
  }
}
```

`submit()` first marks every field touched, showing errors without waiting for blur. For an invalid
field tree, it calls `onInvalid` and resolves without running `action`. Only valid forms reach
`createAccount`, the example API call. `f().submitting()` stays true during `action`, disabling
the button and changing its label through signal bindings.

`action` can return a validation error after validation passes. When `createAccount` returns
`false`, the example names `f.name` as the error's `fieldTree`, so `f.name().errors()` exposes it
like a client-side validation error.

## Arrays

An order, a quote or an invoice is a form with an array of items. An array in the model is an
array of fields in the form: `@for` runs over it, and each item goes to a component of its own as
a `FieldTree`:

```ts
import { Component, input, signal } from '@angular/core';
import { FormField, applyEach, form, required, type FieldTree } from '@angular/forms/signals';
import { Pressable, Text, TextInput } from '@ng-native/components';

interface Line {
  name: string;
  cents: number;
}

@Component({
  selector: 'app-line',
  imports: [FormField, Text, TextInput],
  template: `
    <text-input accessibilityLabel="Line" [formField]="line().name" />
    @if (line().name().touched() && line().name().invalid()) {
      <text accessibilityRole="alert">Name is required</text>
    }
  `,
})
export class LineCard {
  readonly line = input.required<FieldTree<Line>>();
}

@Component({
  selector: 'app-order',
  imports: [LineCard, Pressable, Text],
  template: `
    @for (line of f.lines; track line) {
      <app-line [line]="line" />
    }
    <pressable accessibilityRole="button" (press)="add()"><text>Add a line</text></pressable>
  `,
})
export class Order {
  readonly order = signal<{ lines: Line[] }>({ lines: [{ name: '', cents: 0 }] });
  readonly f = form(this.order, (path) => applyEach(path.lines, (line) => required(line.name)));

  protected add(): void {
    this.f.lines().value.update((lines) => [...lines, { name: '', cents: 0 }]);
  }
}
```

Adding, removing and reordering are updates of the array's own value, `f.lines().value.update()`.
An item's field keeps its identity through a move, so what was typed into it, its `touched` and
its errors follow the item, and `track line` moves its card rather than building another.
`applyEach` gives every item the same rules, and an item's error goes when the item does.

**A control with a model of another name takes a two-way binding.** `[formField]` binds a control
whose model is `value` or `checked`. One whose model is called something else, a price field with
a `cents` model, is bound to the field's own value instead:

```html
<app-price [(cents)]="line().cents().value" />
```

**The model is not deeply equal to the data it was given.** Signal Forms keys each item of an
array with a symbol, so `expect(order()).toEqual({ lines: [...] })` fails on the key.
`toMatchObject` compares the properties it is given and passes.

**A long array costs more per keystroke.** The form's model is one signal, so a keystroke asks
every field of every item whether it changed, though only the one line is committed, and a
`<scroll-view>` mounts a card for every item when the form opens. For hundreds of items, a
[`<virtual-list>`](/packages/components/lists) mounts only the rows on screen.
