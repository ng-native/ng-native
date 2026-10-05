import { Component } from '@angular/core';
import { HlmButtonImports } from './helm/button';
import { HlmPopoverImports } from './helm/popover';
import { HlmTooltipImports } from './helm/tooltip';

/** Spartan UI's popover and tooltip: content positioned against the element that opens it. */
@Component({
  selector: 'app-spartan-overlays',
  imports: [HlmButtonImports, HlmPopoverImports, HlmTooltipImports],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <div class="flex flex-wrap items-center gap-2">
      <hlm-popover sideOffset="5">
        <button hlmPopoverTrigger hlmBtn variant="outline" id="trigger" testID="popover-trigger">
          Open popover
        </button>
        <hlm-popover-content *hlmPopoverPortal="let ctx" testID="popover">
          <hlm-popover-header>
            <h4 hlmPopoverTitle>Dimensions</h4>
            <p hlmPopoverDescription>Set the dimensions for the layer.</p>
          </hlm-popover-header>
        </hlm-popover-content>
      </hlm-popover>

      <button hlmBtn variant="outline" hlmTooltip="Add to library" testID="tooltip-trigger">
        Hover me
      </button>
    </div>
  `,
})
export class SpartanOverlays {}
