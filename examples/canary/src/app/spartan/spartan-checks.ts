import { Component, signal } from '@angular/core';
import { HlmCheckboxImports } from './helm/checkbox';
import { HlmLabelImports } from './helm/label';
import { HlmSwitchImports } from './helm/switch';

/** Spartan UI's checkbox and switch: unchecked, checked, bound both ways, and disabled. */
@Component({
  selector: 'app-spartan-checks',
  imports: [HlmCheckboxImports, HlmLabelImports, HlmSwitchImports],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <p class="text-muted-foreground text-sm">Terms: {{ terms() }}, wifi: {{ wifi() }}</p>
    <div class="flex items-center gap-2">
      <hlm-checkbox testID="terms" [checked]="terms()" (checkedChange)="terms.set($event)" />
      <label hlmLabel>Agree to terms</label>
    </div>
    <div class="flex items-center gap-2">
      <hlm-checkbox testID="checked" [checked]="true" />
      <label hlmLabel>Already checked</label>
    </div>
    <div class="flex items-center gap-2">
      <hlm-checkbox testID="disabled-check" disabled />
      <label hlmLabel>Disabled</label>
    </div>
    <div class="flex items-center gap-2">
      <hlm-switch testID="wifi" [checked]="wifi()" (checkedChange)="wifi.set($event)" />
      <label hlmLabel>Wi-Fi</label>
    </div>
    <div class="flex items-center gap-2">
      <hlm-switch testID="on" [checked]="true" />
      <label hlmLabel>Already on</label>
    </div>
    <div class="flex items-center gap-2">
      <hlm-switch testID="disabled-switch" disabled />
      <label hlmLabel>Disabled</label>
    </div>
  `,
})
export class SpartanChecks {
  protected readonly terms = signal(false);
  protected readonly wifi = signal(false);
}
