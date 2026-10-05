import { Component } from '@angular/core';
import { HlmAspectRatioImports } from './helm/aspect-ratio';
import { HlmButtonImports } from './helm/button';
import { HlmEmptyImports } from './helm/empty';
import { HlmFieldImports } from './helm/field';
import { HlmInputImports } from './helm/input';
import { HlmItemImports } from './helm/item';

/** Spartan UI's field, item, empty state and aspect ratio: layout with no behaviour. */
@Component({
  selector: 'app-spartan-layouts',
  imports: [
    HlmAspectRatioImports,
    HlmButtonImports,
    HlmEmptyImports,
    HlmFieldImports,
    HlmInputImports,
    HlmItemImports,
  ],
  host: { class: 'spartan flex flex-col gap-4' },
  template: `
    <hlm-field testID="field">
      <label hlmFieldLabel for="layout-email">Email</label>
      <input hlmInput id="layout-email" type="email" placeholder="you@example.com" />
      <hlm-field-description>We only use it to sign you in.</hlm-field-description>
    </hlm-field>

    <div hlmItem variant="outline" testID="item">
      <div hlmItemContent>
        <div hlmItemTitle>Two-factor authentication</div>
        <p hlmItemDescription>Verify with a code from your phone.</p>
      </div>
      <div hlmItemActions>
        <button hlmBtn size="sm" variant="outline" testID="item-action">Enable</button>
      </div>
    </div>

    <div hlmEmpty class="border border-dashed" testID="empty">
      <div hlmEmptyHeader>
        <div hlmEmptyTitle>No projects yet</div>
        <div hlmEmptyDescription>Create your first project to get started.</div>
      </div>
      <div hlmEmptyContent>
        <button hlmBtn>Create project</button>
      </div>
    </div>

    <div class="w-48">
      <div [hlmAspectRatio]="16 / 9" class="bg-muted rounded-md" testID="ratio"></div>
    </div>
  `,
})
export class SpartanLayouts {}
