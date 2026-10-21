import { Component, signal } from '@angular/core';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

/** Whether the outlet below is in the tree, for the test to take it out. */
export const shown = signal(true);

@Component({
  selector: 'x-stack-host',
  imports: [NativeStackOutlet],
  template: `
    @if (shown()) {
      <native-stack-outlet />
    }
  `,
})
export class StackHost {
  protected readonly shown = shown;
}

@Component({
  selector: 'x-tabs-host',
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    @if (shown()) {
      <native-tabs-outlet>
        <native-tab path="home" title="Home" />
      </native-tabs-outlet>
    }
  `,
})
export class TabsHost {
  protected readonly shown = shown;
}
