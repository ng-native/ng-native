import { Component, Injectable, inject, signal } from '@angular/core';
import { Text } from '../../components/src/text.ts';

/** What an app initializer loads, for the root component to read. */
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
