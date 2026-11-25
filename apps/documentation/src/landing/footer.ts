/**
 * The foot of the landing page and the blog: the mark, the independence note, the links onward,
 * and the line that credits Coralogix as the project's maintainer.
 */
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { INDEPENDENCE_NOTE, LINKS } from './content.ts';
import { CoralogixLogo } from './coralogix-logo.ts';
import { LandingMark } from './mark.ts';

@Component({
  selector: 'landing-footer',
  imports: [CoralogixLogo, LandingMark, RouterLink],
  template: `
    <footer class="border-t border-ink/15">
      <div
        class="mx-auto grid max-w-[80rem] grid-cols-1 gap-10 px-[var(--gutter)] pt-14 pb-10 md:grid-cols-[1fr_auto]"
      >
        <div class="max-w-[30rem]">
          <a routerLink="/" class="flex items-center gap-2.5">
            <landing-mark class="size-6" />
            <span class="landing-display text-lg">Angular Native</span>
          </a>
          <p class="mt-4 text-sm text-graphite">{{ note }}</p>
        </div>
        <nav aria-label="Footer">
          <ul class="grid grid-cols-2 gap-x-12 gap-y-3 text-sm sm:grid-cols-3">
            <li><a class="hover:text-ng-red-ink" [routerLink]="links.docs">Docs</a></li>
            <li><a class="hover:text-ng-red-ink" [routerLink]="links.examples">Examples</a></li>
            <li><a class="hover:text-ng-red-ink" [href]="links.github">GitHub</a></li>
            <li><a class="hover:text-ng-red-ink" [href]="links.releases">Releases</a></li>
            <li><a class="hover:text-ng-red-ink" [href]="links.issues">Issues</a></li>
            <li><a class="hover:text-ng-red-ink" [href]="links.license">MIT license</a></li>
            <li><a class="hover:text-ng-red-ink" [routerLink]="links.sponsor">Sponsor</a></li>
            <li><a class="hover:text-ng-red-ink" [routerLink]="links.blog">Blog</a></li>
            <li>
              <a class="footer-coralogix font-medium" [href]="links.coralogix">Coralogix</a>
            </li>
          </ul>
        </nav>
      </div>
      <div class="mx-auto max-w-[80rem] px-[var(--gutter)]">
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-t border-ink/15 pt-5 pb-7 text-[0.8125rem] text-graphite"
        >
          <a class="flex items-center gap-2.5 hover:text-ink" [href]="links.coralogix">
            An open-source project by <cx-logo class="h-[1.125rem]" />
          </a>
          <span>© {{ year }} Coralogix</span>
        </div>
      </div>
    </footer>
  `,
  styles: `
    .footer-coralogix {
      text-decoration: underline;
      text-decoration-color: #13e989;
      text-decoration-thickness: 2px;
      text-underline-offset: 4px;
    }
    .footer-coralogix:hover {
      text-decoration-thickness: 3px;
    }
  `,
})
export class LandingFooter {
  protected readonly links = LINKS;
  protected readonly note = INDEPENDENCE_NOTE;
  protected readonly year = new Date().getFullYear();
}
