/**
 * A post's prose: its markdown rendered at build time, with the islands its
 * `<!-- island: name -->` lines mount between the paragraphs. See `build/markdown.ts`.
 *
 * The HTML is this repository's markdown, so it skips the sanitiser for the reason `doc-content.ts`
 * gives.
 */
import { NgComponentOutlet } from '@angular/common';
import { Component, computed, inject, input, type Type } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import type { DocBlock } from '../../build/markdown.ts';
import { CoralogixAbout } from './coralogix-about.ts';

/** Every component a post can mount, by the name its island line gives. */
const ISLANDS: Record<string, Type<unknown>> = { 'coralogix-about': CoralogixAbout };

@Component({
  selector: 'blog-content',
  imports: [NgComponentOutlet],
  template: `
    @for (item of items(); track $index) {
      @if (item.island) {
        <ng-container [ngComponentOutlet]="item.island" />
      } @else {
        <div class="blog-html" [innerHTML]="item.html"></div>
      }
    }
  `,
})
export class BlogContent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly blocks = input.required<readonly DocBlock[]>();

  protected readonly items = computed(() =>
    this.blocks().map((block): { html?: SafeHtml; island?: Type<unknown> } => {
      if (block.kind === 'html')
        return { html: this.sanitizer.bypassSecurityTrustHtml(block.html) };
      const island = block.kind === 'island' ? ISLANDS[block.name] : undefined;
      if (!island) throw new Error(`A blog post cannot mount ${JSON.stringify(block)}`);
      return { island };
    }),
  );
}
