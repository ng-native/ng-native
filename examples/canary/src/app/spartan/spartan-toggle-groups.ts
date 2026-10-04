import { Component, signal } from '@angular/core';
import { HlmCollapsibleImports } from './helm/collapsible';
import { HlmButtonImports } from './helm/button';
import { HlmToggleGroupImports } from './helm/toggle-group';

/** Spartan UI's toggle group, where one press replaces another, and its collapsible. */
@Component({
  selector: 'app-spartan-toggle-groups',
  imports: [HlmButtonImports, HlmCollapsibleImports, HlmToggleGroupImports],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <p class="text-muted-foreground text-sm" testID="group-state">
      Align: {{ align() }}, styles: {{ styles().join(' ') || 'none' }}
    </p>
    <div class="flex">
      <hlm-toggle-group type="single" [(value)]="align" variant="outline" testID="group-single">
        <button hlmToggleGroupItem value="left" testID="align-left">Left</button>
        <button hlmToggleGroupItem value="center" testID="align-center">Center</button>
        <button hlmToggleGroupItem value="right" disabled testID="align-right">Right</button>
      </hlm-toggle-group>
    </div>
    <div class="flex">
      <hlm-toggle-group type="multiple" [(value)]="styles" [spacing]="2" testID="group-multiple">
        <button hlmToggleGroupItem value="bold" testID="style-bold">Bold</button>
        <button hlmToggleGroupItem value="italic" testID="style-italic">Italic</button>
      </hlm-toggle-group>
    </div>

    <hlm-collapsible class="flex flex-col gap-2" testID="collapsible">
      <button hlmCollapsibleTrigger hlmBtn variant="outline" testID="collapsible-trigger">
        Show the details
      </button>
      <hlm-collapsible-content testID="collapsible-content">
        <p class="rounded-md border px-4 py-2 text-sm">The details, shown when it is open.</p>
      </hlm-collapsible-content>
    </hlm-collapsible>
  `,
})
export class SpartanToggleGroups {
  protected readonly align = signal<string | null>('left');
  protected readonly styles = signal<string[]>([]);
}
