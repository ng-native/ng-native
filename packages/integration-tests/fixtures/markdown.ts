import { Component, signal } from '@angular/core';
import type { Token } from 'marked';
import {
  Markdown,
  type MarkdownClasses,
  type MarkdownLinkPress,
} from '../../components/src/markdown.ts';

/** A plain app's screen with a document on it: no router, no Analog, just the component. */
@Component({
  selector: 'x-markdown-screen',
  imports: [Markdown],
  template: `
    <markdown
      [source]="source()"
      [tokens]="tokens()"
      [classes]="classes()"
      (linkPress)="pressed($event)"
    />
  `,
})
export class MarkdownScreen {
  readonly source = signal<string | undefined>(undefined);
  readonly tokens = signal<readonly Token[] | undefined>(undefined);
  readonly classes = signal<MarkdownClasses>({});
  readonly presses: { href: string; title: string | null }[] = [];
  prevent = false;

  pressed(event: MarkdownLinkPress): void {
    this.presses.push({ href: event.href, title: event.title });
    if (this.prevent) event.preventDefault();
  }
}
