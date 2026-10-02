import { Component, ViewEncapsulation, signal } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

/** A component whose CSS is not scoped: Angular adds it to the document as it is written. */
@Component({
  imports: [Text, View],
  selector: 'x-none-chip',
  encapsulation: ViewEncapsulation.None,
  host: { class: 'none-chip' },
  template: '<text class="inner">chip</text>',
  styles: [
    '.none-chip { padding: 1px; --tint: rgb(1, 1, 1) }',
    '.inner { color: var(--tint) }',
    '.outside { background-color: rgb(2, 2, 2) }',
    ':host { margin: 9px }',
  ],
})
export class NoneChip {}

/** The same in Shadow DOM, whose CSS a browser scopes to the component, as it scopes emulated. */
@Component({
  imports: [Text],
  selector: 'x-shadow-chip',
  encapsulation: ViewEncapsulation.ShadowDom,
  template: '<text class="shadow-inner">shadow</text>',
  styles: [
    ':host { padding: 3px } .shadow-inner { color: rgb(3, 3, 3) } .outside { opacity: 0.5 }',
  ],
})
export class ShadowChip {}

@Component({
  imports: [NoneChip, ShadowChip, Text, View],
  selector: 'x-encapsulation-none',
  template: `
    @if (shown()) {
      <x-none-chip />
      <x-none-chip class="mine" />
    }
    <x-shadow-chip />
    <text class="outside">outside</text>
  `,
  styles: ['.mine { padding: 4px }'],
})
export class EncapsulationNone {
  readonly shown = signal(true);
}
