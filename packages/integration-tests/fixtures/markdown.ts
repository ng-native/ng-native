import { Component, signal, viewChild } from '@angular/core';
import type { Token } from 'marked';
import {
  Markdown,
  type MarkdownClasses,
  type MarkdownLinkPress,
} from '../../components/src/markdown.ts';
import { MarkdownColumns } from '../../components/src/markdown-columns.ts';
import type { MarkdownBlock } from '../../components/src/markdown-blocks.ts';

/** A plain app's screen with a document on it: no router, no Analog, just the component. */
@Component({
  selector: 'x-markdown-screen',
  imports: [Markdown],
  template: `
    <markdown
      [source]="source()"
      [tokens]="tokens()"
      [streaming]="streaming()"
      [classes]="classes()"
      (linkPress)="pressed($event)"
    />
  `,
})
export class MarkdownScreen {
  readonly source = signal<string | undefined>(undefined);
  readonly tokens = signal<readonly Token[] | undefined>(undefined);
  readonly classes = signal<MarkdownClasses>({});
  readonly streaming = signal(false);
  readonly presses: { href: string; title: string | null }[] = [];
  prevent = false;

  pressed(event: MarkdownLinkPress): void {
    this.presses.push({ href: event.href, title: event.title });
    if (this.prevent) event.preventDefault();
  }
}

/** A table's columns on their own, measured directly rather than through a layout pass. */
@Component({
  selector: 'x-markdown-columns-screen',
  imports: [MarkdownColumns],
  template: `<view [markdownColumns]="table()"></view>`,
})
export class MarkdownColumnsScreen {
  readonly table = signal<Extract<MarkdownBlock, { kind: 'table' }>>({
    kind: 'table',
    header: [],
    rows: [],
  });
  readonly columns = viewChild.required(MarkdownColumns);
}
