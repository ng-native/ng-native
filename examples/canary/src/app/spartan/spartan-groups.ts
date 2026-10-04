import { Component, signal } from '@angular/core';
import { HlmButtonImports } from './helm/button';
import { HlmButtonGroupImports } from './helm/button-group';
import { HlmContextMenuImports } from './helm/context-menu';
import { HlmDropdownMenuImports } from './helm/dropdown-menu';
import { HlmInputGroupImports } from './helm/input-group';
import { HlmSpinnerImports } from './helm/spinner';

/** Spartan UI's button group, input group, spinner and context menu. */
@Component({
  selector: 'app-spartan-groups',
  imports: [
    HlmButtonImports,
    HlmButtonGroupImports,
    HlmContextMenuImports,
    HlmDropdownMenuImports,
    HlmInputGroupImports,
    HlmSpinnerImports,
  ],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <div class="flex items-center gap-3">
      <div hlmButtonGroup testID="button-group">
        <button hlmBtn variant="outline" testID="group-first">Archive</button>
        <button hlmBtn variant="outline" testID="group-middle">Report</button>
        <button hlmBtn variant="outline" testID="group-last">Snooze</button>
      </div>
      <hlm-spinner testID="spinner" />
    </div>

    <hlm-input-group testID="input-group">
      <input hlmInputGroupInput placeholder="example.com" testID="input-group-input" />
      <hlm-input-group-addon>
        <hlm-input-group-text>https://</hlm-input-group-text>
      </hlm-input-group-addon>
    </hlm-input-group>

    <div
      [hlmContextMenuTrigger]="menu"
      class="flex h-24 items-center justify-center rounded-md border border-dashed text-sm"
      testID="context-trigger"
    >
      Press and hold here: {{ last() }}
    </div>
    <ng-template #menu>
      <hlm-dropdown-menu class="w-48" testID="context-menu">
        <button hlmDropdownMenuItem (triggered)="last.set('back')" testID="context-back">
          Back
        </button>
        <button hlmDropdownMenuItem (triggered)="last.set('reload')">Reload</button>
      </hlm-dropdown-menu>
    </ng-template>
  `,
})
export class SpartanGroups {
  protected readonly last = signal('nothing chosen');
}
