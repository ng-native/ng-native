/// <reference path="../../metro/markdown.d.ts" />
import { Component } from '@angular/core';
import { Markdown } from '../../components/src/markdown.ts';
import notes from './release-notes.md';

/** A plain app's screen that imports a `.md` file: no router, no Analog. */
@Component({
  selector: 'x-markdown-file',
  imports: [Markdown],
  template: `<markdown [tokens]="notes.tokens" />`,
})
export class MarkdownFileScreen {
  readonly notes = notes;
}
