import { Component } from '@angular/core';
import { TabCounter } from '../../ui/tab-counter.ts';

/** The first tab, at the layout's own URL, `/tabs`. */
@Component({
  imports: [TabCounter],
  template: `
    <app-tab-counter
      file="src/app/pages/tabs/index.page.ts"
      explanation="tabs.page.ts is a layout whose outlet is a native tab bar, and each page in tabs/ is a tab. This one is index.page.ts, at /tabs. Add to the count, switch to Laps and back: the count is still here."
      label="COUNTER"
    />
  `,
  styles: `
    :host {
      flex: 1;
    }
  `,
})
export default class CounterTab {}
