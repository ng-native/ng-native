/**
 * The blog's frame: the landing page's header and footer around a page of its own, so the blog
 * reads as part of the home page rather than of the documentation.
 */
import { afterNextRender, Component, input, signal } from '@angular/core';
import { LandingFooter } from '../landing/footer.ts';
import { LandingHeader } from '../landing/header.ts';
import { observePast } from '../landing/scroll.ts';

@Component({
  selector: 'blog-frame',
  imports: [LandingFooter, LandingHeader],
  template: `
    <div class="landing">
      <a
        href="#main"
        class="sr-only z-50 rounded bg-ink px-4 py-2 text-paper-light focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <div class="blog-sentinel absolute top-0 h-2 w-px" aria-hidden="true"></div>
      <landing-header [solid]="scrolled()" [ruled]="scrolled()" [announce]="announce()" />
      <main id="main"><ng-content /></main>
      <landing-footer />
    </div>
  `,
})
export class BlogFrame {
  /** The stewardship bar: off on the post that is the announcement. */
  readonly announce = input(true);
  protected readonly scrolled = signal(false);

  constructor() {
    afterNextRender(() => observePast('.blog-sentinel', (past) => this.scrolled.set(past)));
  }
}
