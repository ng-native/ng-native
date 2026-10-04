import { Component, signal } from '@angular/core';
import { HlmSelectImports } from './helm/select';

/** Spartan UI's select: a trigger that opens a list of options and shows the one chosen. */
@Component({
  selector: 'app-spartan-selects',
  imports: [HlmSelectImports],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <hlm-select [(value)]="fruit">
      <hlm-select-trigger class="w-56" buttonId="fruit" testID="select-trigger">
        <hlm-select-value placeholder="Select a fruit" />
      </hlm-select-trigger>
      <hlm-select-content *hlmSelectPortal testID="select-content">
        <hlm-select-group>
          <hlm-select-label>Fruits</hlm-select-label>
          <hlm-select-item value="Apple" testID="select-apple">Apple</hlm-select-item>
          <hlm-select-item value="Banana" testID="select-banana">Banana</hlm-select-item>
          <hlm-select-item value="Grape" disabled testID="select-grape">Grape</hlm-select-item>
        </hlm-select-group>
      </hlm-select-content>
    </hlm-select>
    <p testID="select-chosen">Chosen: {{ fruit() ?? 'nothing' }}</p>
  `,
})
export class SpartanSelects {
  protected readonly fruit = signal<string | undefined>(undefined);
}
