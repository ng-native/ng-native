import { Component, signal } from '@angular/core';
import { NativeToolbar, NativeToolbarItem } from '../../router/src/native-toolbar.ts';

/** A screen's bottom toolbar as Mail has it: a filter, the search field, and compose. */
@Component({
  selector: 'x-toolbar-host',
  imports: [NativeToolbar, NativeToolbarItem],
  template: `
    <native-toolbar>
      <native-toolbar-item
        systemImageName="line.3.horizontal.decrease"
        accessibilityLabel="Filter"
        (press)="filtered = filtered + 1"
      />
      <native-toolbar-item type="fluidSpacer" />
      <native-toolbar-item type="searchBar" />
      <native-toolbar-item type="fixedSpacer" width="12" />
      @if (composing()) {
        <native-toolbar-item
          title="Compose"
          barButtonItemStyle="prominent"
          hidesSharedBackground
          [disabled]="busy()"
          (press)="composed = composed + 1"
        />
      }
    </native-toolbar>
  `,
})
export class ToolbarHost {
  readonly composing = signal(true);
  readonly busy = signal(false);
  filtered = 0;
  composed = 0;
}
