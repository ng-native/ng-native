/**
 * Fixture for `app-initializers.test.ts`. See `button-app.ts` for why a `@Component` lives out here.
 */
import { Component, Injectable, inject, signal } from '@angular/core';
import { Text } from '@ng-native/components';

@Injectable({ providedIn: 'root' })
export class Greeting {
  readonly text = signal('not loaded');
}

@Component({
  selector: 'app-root',
  imports: [Text],
  template: `<text>{{ greeting.text() }}</text>`,
})
export class InitializedApp {
  protected readonly greeting = inject(Greeting);
  /** What the greeting said when the root component was created, before its first render. */
  readonly textAtCreation = this.greeting.text();
}
