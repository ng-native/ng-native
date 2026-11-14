import { Component, input, signal } from '@angular/core';
import { nativePlatform, registerViewName } from '@ng-native/fabric';
import { Pressable } from './pressable.ts';
import { optionalBoolean } from './transforms.ts';
import { Text } from './text.ts';
import { ViewBase } from './view-base.ts';

/**
 * On macOS a group of the sidebar's source list, a model object the desktop host reads its rows
 * from. Neighbouring sections in one parent are one NSOutlineView. Elsewhere a view, drawn here.
 */
registerViewName('sidebar-section', {
  ios: 'View',
  android: 'View',
  macos: 'NgNativeSidebarSection',
});

/**
 * A group of `<sidebar-item>`s with an optional `title`. A `collapsible` one shows and hides its
 * items from its title: on macOS with the source list's own disclosure, drawn by a press on the
 * title elsewhere. Selection survives the section collapsing.
 */
@Component({
  selector: 'sidebar-section',
  imports: [Pressable, Text],
  template: `
    @if (drawn && title()) {
      <pressable
        class="sidebar-section-title"
        accessibilityRole="header"
        [disabled]="!collapsible()"
        (press)="expanded.set(!expanded())"
      >
        <text>{{ title() }}</text>
      </pressable>
    }
    @if (!drawn || expanded()) {
      <ng-content />
    }
  `,
  styles: `
    .sidebar-section-title {
      padding: 8px 12px 4px;
      opacity: 0.6;
    }
  `,
  host: {
    '[title]': 'drawn ? undefined : title()',
    '[collapsible]': 'drawn ? undefined : collapsible()',
  },
})
export class SidebarSection extends ViewBase {
  /** Whether this section is drawn here rather than by the desktop host. */
  protected readonly drawn = nativePlatform() !== 'macos';
  /** Drawn, whether the items show: a collapsible section's title toggles it. */
  protected readonly expanded = signal(true);

  /** The heading over the section's items. None gives an untitled group. */
  readonly title = input<string>();
  /** Whether the title shows and hides the section's items. */
  readonly collapsible = input(false, { transform: optionalBoolean });
}
