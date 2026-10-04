import { Component, signal } from '@angular/core';
import { HlmAlertImports } from './helm/alert';
import { HlmButtonImports } from './helm/button';
import { HlmProgressImports } from './helm/progress';
import { HlmSeparatorImports } from './helm/separator';
import { HlmSkeletonImports } from './helm/skeleton';

/** Spartan UI's alert, progress bar, separator and skeleton. */
@Component({
  selector: 'app-spartan-feedback',
  imports: [
    HlmAlertImports,
    HlmButtonImports,
    HlmProgressImports,
    HlmSeparatorImports,
    HlmSkeletonImports,
  ],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <div hlmAlert testID="alert">
      <h4 hlmAlertTitle testID="alert-title">Heads up</h4>
      <p hlmAlertDescription testID="alert-description">An alert with a title and a description.</p>
    </div>
    <div hlmAlert variant="destructive" testID="destructive">
      <h4 hlmAlertTitle>Something went wrong</h4>
      <p hlmAlertDescription testID="destructive-description">Your session has expired.</p>
    </div>

    <hlm-progress [value]="progress()" testID="progress">
      <hlm-progress-indicator testID="indicator" />
    </hlm-progress>
    <button hlmBtn variant="outline" size="sm" testID="advance" (click)="advance()">Advance</button>

    <hlm-separator testID="separator" />
    <div class="flex h-5 items-center gap-3">
      <p>One</p>
      <hlm-separator orientation="vertical" testID="vertical" />
      <p>Two</p>
    </div>

    <div class="flex items-center gap-3">
      <hlm-skeleton class="size-10 rounded-full" testID="avatar" />
      <div class="flex flex-col gap-2">
        <hlm-skeleton class="h-4 w-40" testID="line" />
        <hlm-skeleton class="h-4 w-28" />
      </div>
    </div>
  `,
})
export class SpartanFeedback {
  protected readonly progress = signal(40);

  protected advance(): void {
    this.progress.update((value) => (value >= 100 ? 0 : value + 20));
  }
}
