import { Component, inject, signal, type TemplateRef, viewChild } from '@angular/core';
import { TuiButton } from '@taiga-ui/core/components/button';
import { TuiDialogService } from '@taiga-ui/core/portals/dialog';
import { TuiAccordion } from '@taiga-ui/kit/components/accordion';
import { TuiTabs } from '@taiga-ui/kit/components/tabs';

/** Help: Taiga's tabs over questions in its accordion, and a dialog opened from its service. */
@Component({
  selector: 'app-help-section',
  imports: [TuiAccordion, TuiButton, TuiTabs],
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
  `,
  template: `
    <tui-tabs [(activeItemIndex)]="tab">
      <button tuiTab>Account</button>
      <button tuiTab>Billing</button>
    </tui-tabs>
    @if (tab() === 0) {
      <tui-accordion>
        <button tuiAccordion>Can I change my plan later?</button>
        <tui-expand>
          <p>
            Yes. A new plan starts on the day you pick it, and the old one is refunded pro rata.
          </p>
        </tui-expand>
        <button tuiAccordion>Where is my data kept?</button>
        <tui-expand>
          <p>On servers in the European Union, encrypted at rest.</p>
        </tui-expand>
      </tui-accordion>
    } @else {
      <p>Invoices are emailed on the first of each month.</p>
    }
    <button tuiButton appearance="flat" (click)="contactSupport()">Contact support</button>

    <ng-template #support let-observer>
      <p>Write to support&#64;example.com and we answer within a working day.</p>
      <button tuiButton size="m" (click)="observer.complete()">Got it</button>
    </ng-template>
  `,
})
export class HelpSection {
  private readonly dialogs = inject(TuiDialogService);
  private readonly support = viewChild.required<TemplateRef<unknown>>('support');
  /** The tab Help shows: the account's questions, or billing. */
  protected readonly tab = signal(0);

  protected contactSupport(): void {
    this.dialogs
      .open(this.support(), { label: 'Contact support', size: 's', closable: false })
      .subscribe();
  }
}
