/**
 * Fixture for `markdown.test.ts`. See `button-app.ts` for why a `@Component` lives out here.
 */
import { Component, signal } from '@angular/core';
import { Markdown, type MarkdownLinkPress } from '@ng-native/components/markdown';

@Component({
  selector: 'app-root',
  imports: [Markdown],
  template: `<markdown [source]="source()" (linkPress)="pressed($event)" />`,
})
export class MarkdownApp {
  readonly source = signal('');
  readonly presses: string[] = [];

  pressed(event: MarkdownLinkPress): void {
    this.presses.push(event.href);
    event.preventDefault();
  }
}
