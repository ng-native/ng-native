import { Component, signal } from '@angular/core';
import { HlmButtonImports } from './helm/button';
import { HlmDropdownMenuImports } from './helm/dropdown-menu';

/** Spartan UI's dropdown menu: a button that opens a list of actions over the page. */
@Component({
  selector: 'app-spartan-menus',
  imports: [HlmButtonImports, HlmDropdownMenuImports],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <p class="text-muted-foreground text-sm" testID="menu-state">
      Last: {{ last() }}, status bar: {{ statusBar() }}
    </p>
    <div class="flex">
      <button
        hlmBtn
        variant="outline"
        [hlmDropdownMenuTrigger]="menu"
        id="menu-trigger"
        testID="menu-trigger"
      >
        Open menu
      </button>
    </div>
    <ng-template #menu>
      <hlm-dropdown-menu class="w-56" testID="menu">
        <hlm-dropdown-menu-label>My account</hlm-dropdown-menu-label>
        <hlm-dropdown-menu-separator />
        <hlm-dropdown-menu-group>
          <button hlmDropdownMenuItem (triggered)="last.set('profile')" testID="menu-profile">
            Profile
            <hlm-dropdown-menu-shortcut>⇧⌘P</hlm-dropdown-menu-shortcut>
          </button>
          <button
            hlmDropdownMenuItem
            disabled
            (triggered)="last.set('billing')"
            testID="menu-billing"
          >
            Billing
          </button>
        </hlm-dropdown-menu-group>
        <hlm-dropdown-menu-separator />
        <button
          hlmDropdownMenuCheckbox
          [checked]="statusBar()"
          (triggered)="statusBar.set(!statusBar())"
          testID="menu-status"
        >
          Status bar
          <hlm-dropdown-menu-checkbox-indicator />
        </button>
        <hlm-dropdown-menu-separator />
        <button
          hlmDropdownMenuItem
          variant="destructive"
          (triggered)="last.set('delete')"
          testID="menu-delete"
        >
          Delete
        </button>
      </hlm-dropdown-menu>
    </ng-template>
  `,
})
export class SpartanMenus {
  protected readonly last = signal('nothing');
  protected readonly statusBar = signal(false);
}
