import { Component, signal } from '@angular/core';
import { HlmSliderImports } from './helm/slider';

/** Spartan UI's slider: a thumb dragged along a track to choose a number. */
@Component({
  selector: 'app-spartan-sliders',
  imports: [HlmSliderImports],
  host: { class: 'spartan flex flex-col gap-4' },
  template: `
    <p class="text-muted-foreground text-sm" testID="slider-state">Volume: {{ volume()[0] }}</p>
    <hlm-slider [(value)]="volume" [max]="100" [step]="10" id="volume" testID="slider" />
    <hlm-slider [value]="[25, 75]" testID="slider-range" />
    <hlm-slider [value]="[40]" disabled testID="slider-disabled" />
  `,
})
export class SpartanSliders {
  protected readonly volume = signal([30]);
}
