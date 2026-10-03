import { Component, signal } from '@angular/core';
import { HlmButtonImports } from './helm/button';

/** Spartan UI's button, every variant and size, as its own documentation writes them. */
@Component({
  selector: 'app-spartan-buttons',
  imports: [HlmButtonImports],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <p class="text-muted-foreground text-sm">Presses: {{ presses() }}</p>
    <div class="flex flex-wrap gap-2">
      <button hlmBtn testID="default" (click)="press()">Default</button>
      <button hlmBtn testID="secondary" variant="secondary" (click)="press()">Secondary</button>
      <button hlmBtn testID="outline" variant="outline" (click)="press()">Outline</button>
      <button hlmBtn testID="destructive" variant="destructive" (click)="press()">
        Destructive
      </button>
      <button hlmBtn testID="ghost" variant="ghost" (click)="press()">Ghost</button>
      <button hlmBtn testID="link" variant="link" (click)="press()">Link</button>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <button hlmBtn testID="xs" size="xs">Extra small</button>
      <button hlmBtn testID="sm" size="sm">Small</button>
      <button hlmBtn testID="lg" size="lg">Large</button>
      <button hlmBtn testID="disabled" disabled (click)="press()">Disabled</button>
    </div>
  `,
})
export class SpartanButtons {
  protected readonly presses = signal(0);

  protected press(): void {
    this.presses.update((count) => count + 1);
  }
}
