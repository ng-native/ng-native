import { Component, signal } from '@angular/core';
import { BrnInputOtp } from '@spartan-ng/brain/input-otp';
import { HlmAlertDialogImports } from './helm/alert-dialog';
import { HlmButtonImports } from './helm/button';
import { HlmHoverCardImports } from './helm/hover-card';
import { HlmInputOtpImports } from './helm/input-otp';

/** Spartan UI's alert dialog, hover card and one-time-code input. */
@Component({
  selector: 'app-spartan-prompts',
  imports: [
    BrnInputOtp,
    HlmAlertDialogImports,
    HlmButtonImports,
    HlmHoverCardImports,
    HlmInputOtpImports,
  ],
  host: { class: 'spartan flex flex-col gap-4' },
  template: `
    <p class="text-muted-foreground text-sm" testID="prompt-state">
      Deleted: {{ deleted() }}, code: {{ code() || 'none' }}
    </p>
    <div class="flex flex-wrap items-center gap-2">
      <hlm-alert-dialog>
        <button hlmAlertDialogTrigger hlmBtn variant="outline" testID="alert-dialog-trigger">
          Delete account
        </button>
        <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx" testID="alert-dialog">
          <hlm-alert-dialog-header>
            <h2 hlmAlertDialogTitle>Are you absolutely sure?</h2>
            <p hlmAlertDialogDescription>This cannot be undone.</p>
          </hlm-alert-dialog-header>
          <hlm-alert-dialog-footer>
            <button hlmAlertDialogCancel (click)="ctx.close()" testID="alert-dialog-cancel">
              Cancel
            </button>
            <button
              hlmAlertDialogAction
              (click)="deleted.set(deleted() + 1); ctx.close()"
              testID="alert-dialog-action"
            >
              Continue
            </button>
          </hlm-alert-dialog-footer>
        </hlm-alert-dialog-content>
      </hlm-alert-dialog>

      <hlm-hover-card>
        <button hlmHoverCardTrigger hlmBtn variant="link" testID="hover-card-trigger">
          &#64;analogjs
        </button>
        <hlm-hover-card-content *hlmHoverCardPortal testID="hover-card">
          <p class="text-sm">The Angular meta-framework.</p>
        </hlm-hover-card-content>
      </hlm-hover-card>
    </div>

    <brn-input-otp hlmInputOtp [length]="4" [(value)]="code" testID="otp">
      <div hlmInputOtpGroup>
        <hlm-input-otp-slot index="0" testID="otp-slot-0" />
        <hlm-input-otp-slot index="1" />
        <hlm-input-otp-slot index="2" />
        <hlm-input-otp-slot index="3" />
      </div>
    </brn-input-otp>
  `,
})
export class SpartanPrompts {
  protected readonly deleted = signal(0);
  protected readonly code = signal('');
}
