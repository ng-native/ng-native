import { Component } from '@angular/core';
import { HlmBadgeImports } from './helm/badge';

/** Spartan UI's badge, every variant, on a span and as a link. */
@Component({
  selector: 'app-spartan-badges',
  imports: [HlmBadgeImports],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <div class="flex flex-wrap items-center gap-2">
      <span hlmBadge testID="default">Default</span>
      <span hlmBadge testID="secondary" variant="secondary">Secondary</span>
      <span hlmBadge testID="outline" variant="outline">Outline</span>
      <span hlmBadge testID="destructive" variant="destructive">Destructive</span>
      <span hlmBadge testID="ghost" variant="ghost">Ghost</span>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <a hlmBadge testID="link">A link</a>
      <span hlmBadge testID="count" variant="secondary">8</span>
      <span hlmBadge testID="long" variant="outline">A longer label</span>
    </div>
    <!-- On its own in a column, where a browser keeps it as wide as its label. -->
    <span hlmBadge testID="alone">On its own</span>
  `,
})
export class SpartanBadges {}
