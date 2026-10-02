/**
 * Fixtures for `hydration.test.ts`: a host app that is hydrated from server-rendered markup, with
 * an island in its template. See `button-app.ts` for why a `@Component` lives out here rather than
 * in the test file.
 *
 * The templates have no control flow, so the server-rendered markup the test hand-writes for them
 * needs no serialized container data: one `ngh` index whose data is empty.
 */
import { Component, Service, inject, signal } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { NgNativeIsland } from './island.ts';

/** Shared by the host page and its island, so a press in one shows in the other. */
@Service()
export class Presses {
  readonly count = signal(0);
}

/** A component inside the island, so on a host element the island's renderer created. */
@Component({
  selector: 'app-press-label',
  imports: [Text],
  template: `<text id="island-label">Presses: {{ presses.count() }}</text>`,
})
export class PressLabel {
  readonly presses = inject(Presses);
}

/** The island. */
@Component({
  selector: 'app-press-counter',
  imports: [Pressable, PressLabel],
  template: `
    <pressable id="island-press" (press)="presses.count.set(presses.count() + 1)">
      <app-press-label />
    </pressable>
  `,
})
export class PressCounter {
  readonly presses = inject(Presses);
}

@Component({
  selector: 'app-hydrated-host',
  imports: [NgNativeIsland],
  template: `<p id="host-count">{{ presses.count() }}</p>
    <ng-native-island [component]="island" />`,
})
export class HydratedHost {
  readonly presses = inject(Presses);
  readonly island = PressCounter;
}
