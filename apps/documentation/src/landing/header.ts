/**
 * The landing page's header: a narrow label along the top of the sheet, under a dark bar that
 * announces Coralogix's stewardship.
 *
 * Transparent over the hero, then the page's own colour with a thin rule once the hero has gone -
 * `solid` is set by the page, which knows where the hero ends. The bar folds away once the page
 * scrolls. On a narrow screen the links move into a full-screen menu rather than a dropdown too
 * small to hit. The theme switch is the docs' own, so light or dark carries between the two.
 *
 * The blog shares this header, with `announce` off on a post (the post is the announcement).
 */
import { Component, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMoon, lucideSun } from '@ng-icons/lucide';
import { DocsTheme } from '../theme.ts';
import { LINKS } from './content.ts';
import { CoralogixLogo } from './coralogix-logo.ts';
import { LandingMark } from './mark.ts';

@Component({
  selector: 'landing-header',
  imports: [CoralogixLogo, LandingMark, NgIcon, NgTemplateOutlet, RouterLink, RouterLinkActive],
  providers: [provideIcons({ lucideMoon, lucideSun })],
  template: `
    <!--
      Fixed rather than sticky (see landing.css), so the flow needs the bar's and the header's
      height kept for it: a hidden copy of the bar, which wraps exactly as the real one does.
    -->
    @if (announce()) {
      <div class="landing-announce invisible" aria-hidden="true" inert>
        <ng-container [ngTemplateOutlet]="announcement" />
      </div>
    }
    <div class="h-[calc(4rem+1px)]"></div>

    <div class="landing-top">
      @if (announce()) {
        <div
          class="landing-announce-fold"
          [attr.data-folded]="solid()"
          [attr.inert]="solid() ? '' : null"
        >
          <div class="landing-announce">
            <ng-container [ngTemplateOutlet]="announcement" />
          </div>
        </div>
      }
      <header
        class="landing-header"
        [attr.data-solid]="solid() || open()"
        [attr.data-ruled]="ruled()"
      >
        <nav
          class="mx-auto flex h-16 max-w-[80rem] items-center gap-6 px-[var(--gutter)]"
          aria-label="Main"
        >
          <a routerLink="/" class="flex items-center gap-2.5" aria-label="Angular Native, home">
            <landing-mark class="size-7" />
            <span class="landing-display text-[1.05rem] tracking-[-0.02em]">Angular Native</span>
          </a>
          <a
            [href]="links.coralogix"
            target="_blank"
            rel="noopener"
            aria-label="Coralogix (opens in a new tab)"
            class="-ml-2 hidden items-center gap-[7px] border-l border-ink/15 pl-3.5 text-[0.8125rem] text-graphite sm:flex"
          >
            <span>by</span>
            <cx-logo class="h-4" />
          </a>

          <ul class="ml-auto hidden items-center gap-6 text-[0.9375rem] lg:flex xl:gap-7">
            <li><a class="hover:text-ng-red-ink" [routerLink]="links.docs">Docs</a></li>
            <li><a class="hover:text-ng-red-ink" [routerLink]="links.learn">Learn</a></li>
            <li><a class="hover:text-ng-red-ink" [routerLink]="links.examples">Examples</a></li>
            <li>
              <a
                class="hover:text-ng-red-ink"
                [routerLink]="links.blog"
                routerLinkActive="font-[550] text-ng-red-ink"
                ariaCurrentWhenActive="page"
                >Blog</a
              >
            </li>
            <li><a class="hover:text-ng-red-ink" [href]="links.github">GitHub</a></li>
            <li>
              <a
                class="flex items-center gap-1.5 hover:text-ng-red-ink"
                [routerLink]="links.sponsor"
                >Sponsor</a
              >
            </li>
            <li>
              <a
                class="landing-button !min-h-10"
                data-kind="primary"
                [routerLink]="links.getStarted"
              >
                Get started
              </a>
            </li>
          </ul>

          <!-- The site's own theme switch, so a reader's choice carries between here and the docs. -->
          <button
            type="button"
            class="ml-auto inline-flex size-10 items-center justify-center rounded-md text-graphite transition-colors hover:text-ink lg:ml-0"
            [attr.aria-label]="
              'Switch to ' + (theme.scheme() === 'dark' ? 'light' : 'dark') + ' theme'
            "
            (click)="theme.toggle()"
          >
            <ng-icon
              [name]="theme.scheme() === 'dark' ? 'lucideSun' : 'lucideMoon'"
              class="text-lg"
            />
          </button>

          <button
            type="button"
            class="inline-flex size-11 items-center justify-center lg:hidden"
            aria-controls="landing-menu"
            [attr.aria-expanded]="open()"
            (click)="open.set(true)"
          >
            <span class="sr-only">Menu</span>
            <svg viewBox="0 0 24 24" class="size-6" aria-hidden="true">
              <path
                d="M4 8h16M4 16h11"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </nav>
      </header>
    </div>

    @if (open()) {
      <div
        id="landing-menu"
        class="landing-menu lg:hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <div class="flex h-14 items-center justify-between">
          <span class="landing-display text-lg">Angular Native</span>
          <button
            type="button"
            class="inline-flex size-11 items-center justify-center"
            (click)="open.set(false)"
          >
            <span class="sr-only">Close menu</span>
            <svg viewBox="0 0 24 24" class="size-6" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6 6 18"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>
        <!-- Each link fills its row, so a tap beside the word still follows it. -->
        <ul class="landing-display mt-7 flex flex-col text-4xl" (click)="open.set(false)">
          <li><a class="block py-3" [routerLink]="links.docs">Docs</a></li>
          <li><a class="block py-3" [routerLink]="links.learn">Learn</a></li>
          <li><a class="block py-3" [routerLink]="links.examples">Examples</a></li>
          <li><a class="block py-3" [routerLink]="links.blog">Blog</a></li>
          <li><a class="block py-3" [href]="links.github">GitHub</a></li>
          <li><a class="block py-3" [routerLink]="links.sponsor">Sponsor</a></li>
        </ul>
        <a
          class="mt-auto flex items-center gap-2.5 py-4 text-sm text-graphite"
          href="/#stewardship"
          (click)="open.set(false)"
        >
          Maintained by <cx-logo class="h-5" />
        </a>
        <a
          class="landing-button justify-center"
          data-kind="primary"
          [routerLink]="links.getStarted"
          (click)="open.set(false)"
        >
          Get started
        </a>
      </div>
    }

    <ng-template #announcement>
      <div
        class="mx-auto flex min-h-10 max-w-[80rem] flex-wrap items-center justify-center gap-x-2.5 gap-y-0.5 px-[var(--gutter)] py-2 text-center"
      >
        <svg class="size-4 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="7.5" fill="#86ffc9" />
          <circle cx="8" cy="8" r="5.4" fill="#13e989" />
        </svg>
        <span>Angular Native is now maintained by Coralogix.</span>
        <a class="underline underline-offset-3 hover:text-white" [routerLink]="links.announcement"
          >Read the announcement</a
        >
      </div>
    </ng-template>
  `,
  host: { '(document:keydown.escape)': 'open.set(false)' },
})
export class LandingHeader {
  protected readonly theme = inject(DocsTheme);
  /** The page has scrolled: a paper ground, so nothing shows through the links. */
  readonly solid = input(false);
  /** Past the hero: the thin rule under the label as well. */
  readonly ruled = input(false);
  /** The bar above the header that announces Coralogix's stewardship. */
  readonly announce = input(true);

  protected readonly links = LINKS;
  protected readonly open = signal(false);
}
