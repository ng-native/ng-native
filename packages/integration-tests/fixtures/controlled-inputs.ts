import { Component, signal, viewChild } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { Switch } from '../../components/src/switch.ts';
import { TextInput } from '../../components/src/text-input.ts';
import { View } from '../../components/src/view.ts';

/** A switch the app puts straight back: the repro from the bug report. */
@Component({
  selector: 'x-refused-switch',
  imports: [Switch],
  template: '<switch nativeID="sw" [(checked)]="on" (checkedChange)="on.set(false)" />',
})
export class RefusedSwitch {
  readonly on = signal(false);
  readonly control = viewChild.required(Switch);
}

/** A switch bound one way, with the app deciding in its own handler. */
@Component({
  selector: 'x-one-way-switch',
  imports: [Switch],
  template: '<switch nativeID="sw" [checked]="on()" (checkedChange)="decide($event)" />',
})
export class OneWaySwitch {
  readonly on = signal(false);
  readonly allow = signal(true);
  readonly control = viewChild.required(Switch);

  protected decide(next: boolean): void {
    if (this.allow()) this.on.set(next);
  }
}

@Component({
  selector: 'x-accepted-switch',
  imports: [Switch],
  template: '<switch nativeID="sw" [(checked)]="on" />',
})
export class AcceptedSwitch {
  readonly on = signal(false);
}

/** Nothing bound, so the switch keeps its own state. */
@Component({
  selector: 'x-free-switch',
  imports: [Switch],
  template: '<switch nativeID="sw" (checkedChange)="log.push($event)" />',
})
export class FreeSwitch {
  readonly log: boolean[] = [];
  readonly control = viewChild.required(Switch);
}

/** Digits only: anything else is refused, and the binding writes back what it wrote before. */
@Component({
  selector: 'x-refused-input',
  imports: [TextInput],
  template: '<text-input nativeID="field" [value]="digits()" (changeText)="accept($event)" />',
})
export class RefusedInput {
  readonly digits = signal('12');
  readonly control = viewChild.required(TextInput);

  protected accept(text: string): void {
    if (/^\d*$/.test(text)) this.digits.set(text);
  }
}

@Component({
  selector: 'x-shouting-input',
  imports: [TextInput],
  template:
    '<text-input nativeID="field" [value]="text()" (changeText)="text.set($event.toUpperCase())" />',
})
export class ShoutingInput {
  readonly text = signal('');
  readonly control = viewChild.required(TextInput);
}

@Component({
  selector: 'x-accepted-input',
  imports: [TextInput],
  template: '<text-input nativeID="field" [(value)]="text" />',
})
export class AcceptedInput {
  readonly text = signal('');
}

/** Nothing bound, so the field keeps what is typed. */
@Component({
  selector: 'x-free-input',
  imports: [TextInput],
  template: '<text-input nativeID="field" />',
})
export class FreeInput {
  readonly control = viewChild.required(TextInput);
}

@Component({
  selector: 'x-controlled-form',
  imports: [FormField, TextInput, Switch, View],
  template: `
    <view>
      <text-input nativeID="field" [formField]="f.name" />
      <switch nativeID="sw" [formField]="f.subscribed" />
    </view>
  `,
})
export class ControlledForm {
  readonly data = signal({ name: '', subscribed: false });
  readonly f = form(this.data);
  readonly field = viewChild.required(TextInput);
  readonly toggle = viewChild.required(Switch);
}

/** A field whose caret the app places from code. */
@Component({
  selector: 'x-selected-input',
  imports: [TextInput],
  template: '<text-input nativeID="field" [(value)]="text" [selection]="selection()" />',
})
export class SelectedInput {
  readonly text = signal('hello');
  readonly selection = signal<{ start: number; end?: number } | undefined>(undefined);
}

/** A field with a selection from its first render. */
@Component({
  selector: 'x-initially-selected-input',
  imports: [TextInput],
  template: '<text-input nativeID="field" value="hello" [selection]="{ start: 1, end: 4 }" />',
})
export class InitiallySelectedInput {}

/** Android's caret and handle colours, each set or left to follow the selection colour. */
@Component({
  selector: 'x-coloured-input',
  imports: [TextInput],
  template: `
    <text-input
      nativeID="field"
      [selectionColor]="selectionColor()"
      [cursorColor]="cursorColor()"
      [selectionHandleColor]="handleColor()"
    />
  `,
})
export class ColouredInput {
  readonly selectionColor = signal<string | undefined>('red');
  readonly cursorColor = signal<string | undefined>(undefined);
  readonly handleColor = signal<string | undefined>(undefined);
}
