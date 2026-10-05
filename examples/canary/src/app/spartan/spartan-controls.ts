import { Component, signal } from '@angular/core';
import { HlmAvatarImports } from './helm/avatar';
import { HlmLabelImports } from './helm/label';
import { HlmRadioGroupImports } from './helm/radio-group';
import { HlmTextareaImports } from './helm/textarea';
import { HlmToggleImports } from './helm/toggle';

/** Spartan UI's toggle, radio group, textarea and avatar. */
@Component({
  selector: 'app-spartan-controls',
  imports: [
    HlmAvatarImports,
    HlmLabelImports,
    HlmRadioGroupImports,
    HlmTextareaImports,
    HlmToggleImports,
  ],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <p class="text-muted-foreground text-sm">Bold: {{ bold() }}, plan: {{ plan() }}</p>
    <div class="flex items-center gap-2">
      <button
        hlmToggle
        testID="bold"
        [state]="bold() ? 'on' : 'off'"
        (stateChange)="bold.set($event === 'on')"
      >
        Bold
      </button>
      <button hlmToggle variant="outline" testID="italic">Italic</button>
      <button hlmToggle disabled testID="disabled-toggle">Disabled</button>
    </div>

    <hlm-radio-group testID="plans" [value]="plan()" (valueChange)="plan.set($any($event))">
      <label class="flex items-center gap-2" hlmLabel>
        <hlm-radio value="free" testID="free"><hlm-radio-indicator indicator /></hlm-radio>
        Free
      </label>
      <label class="flex items-center gap-2" hlmLabel>
        <hlm-radio value="pro" testID="pro"><hlm-radio-indicator indicator /></hlm-radio>
        Pro
      </label>
    </hlm-radio-group>

    <textarea hlmTextarea testID="notes" placeholder="Notes"></textarea>

    <div class="flex items-center gap-2">
      <hlm-avatar testID="avatar">
        <span hlmAvatarFallback testID="fallback">AH</span>
      </hlm-avatar>
      <hlm-avatar size="lg" testID="large-avatar">
        <span hlmAvatarFallback>NG</span>
      </hlm-avatar>
    </div>
  `,
})
export class SpartanControls {
  protected readonly bold = signal(false);
  protected readonly plan = signal('free');
}
