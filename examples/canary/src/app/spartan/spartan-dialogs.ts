import { Component, signal } from '@angular/core';
import { HlmButtonImports } from './helm/button';
import { HlmDialogImports } from './helm/dialog';

/** Spartan UI's dialog: a trigger, a panel over a dimmed backdrop, and buttons that close it. */
@Component({
  selector: 'app-spartan-dialogs',
  imports: [HlmButtonImports, HlmDialogImports],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <p class="text-muted-foreground text-sm">Deleted: {{ deleted() }}</p>
    <hlm-dialog>
      <button hlmDialogTrigger hlmBtn variant="outline" testID="open">Open dialog</button>
      <hlm-dialog-content *hlmDialogPortal="let ctx" [showCloseButton]="false" testID="content">
        <hlm-dialog-header>
          <h3 hlmDialogTitle>Delete file?</h3>
          <p hlmDialogDescription>This cannot be undone.</p>
        </hlm-dialog-header>
        <hlm-dialog-footer>
          <button hlmBtn variant="outline" hlmDialogClose testID="cancel">Cancel</button>
          <button hlmBtn variant="destructive" hlmDialogClose testID="delete" (click)="remove()">
            Delete
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class SpartanDialogs {
  protected readonly deleted = signal(0);

  protected remove(): void {
    this.deleted.update((count) => count + 1);
  }
}
