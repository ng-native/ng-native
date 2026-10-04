import { Component } from '@angular/core';
import { HlmButtonImports } from './helm/button';
import { HlmSheetImports } from './helm/sheet';

/** Spartan UI's sheet: a panel that slides in from an edge of the screen, over a backdrop. */
@Component({
  selector: 'app-spartan-sheets',
  imports: [HlmButtonImports, HlmSheetImports],
  host: { class: 'spartan flex flex-row flex-wrap gap-2' },
  template: `
    <hlm-sheet>
      <button hlmSheetTrigger side="right" hlmBtn variant="outline" testID="sheet-right">
        From the right
      </button>
      <hlm-sheet-content *hlmSheetPortal="let ctx" testID="sheet">
        <hlm-sheet-header>
          <h3 hlmSheetTitle>Edit profile</h3>
          <p hlmSheetDescription>Make changes to your profile here.</p>
        </hlm-sheet-header>
        <hlm-sheet-footer>
          <button hlmBtn hlmSheetClose testID="sheet-save">Save changes</button>
        </hlm-sheet-footer>
      </hlm-sheet-content>
    </hlm-sheet>

    <hlm-sheet>
      <button hlmSheetTrigger side="bottom" hlmBtn variant="outline" testID="sheet-bottom">
        From the bottom
      </button>
      <hlm-sheet-content *hlmSheetPortal="let ctx" testID="sheet">
        <hlm-sheet-header>
          <h3 hlmSheetTitle>Share</h3>
          <p hlmSheetDescription>Anyone with the link can view this.</p>
        </hlm-sheet-header>
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export class SpartanSheets {}
