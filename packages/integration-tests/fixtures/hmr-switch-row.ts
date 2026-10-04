import { Component, Directive, input, model, output, signal } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { Text } from '../../components/src/text.ts';

@Directive({ selector: '[xPressed]' })
export class Pressed {
  readonly press = output<void>();
}

/** A custom form control with a `checked` model, a host directive and an external stylesheet. */
@Component({
  selector: 'x-switch-row',
  imports: [Text],
  hostDirectives: [{ directive: Pressed, outputs: ['press'] }],
  host: { '(press)': 'checked.set(!checked())' },
  styleUrl: './hmr-switch-row.css',
  template: `<text class="title">{{ title() }} {{ checked() ? 'on' : 'off' }}</text>`,
})
export class SwitchRow {
  readonly title = input.required<string>();
  readonly checked = model(false);
}

@Component({
  selector: 'x-switch-row-page',
  imports: [FormField, SwitchRow],
  template: `<x-switch-row title="Open-ended" [formField]="f.open" />`,
})
export class SwitchRowPage {
  protected readonly data = signal({ open: true });
  protected readonly f = form(this.data);
}
