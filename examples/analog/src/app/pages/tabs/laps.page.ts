import { Component } from '@angular/core';
import { TabCounter } from '../../ui/tab-counter.ts';

/** The second tab, at `/tabs/laps`. */
@Component({
  imports: [TabCounter],
  template: `
    <app-tab-counter
      file="src/app/pages/tabs/laps.page.ts"
      explanation="The second tab, laps.page.ts at /tabs/laps. Each tab keeps its own screen, so its count stays while the other tab is in front."
      label="LAPS"
    />
  `,
  styles: `
    :host {
      flex: 1;
    }
  `,
})
export default class LapsTab {}
