/**
 * The end of the page: one line, and the ways onward.
 *
 * Type only, centred under the mark - the page has shown enough screens by here, and the hero's
 * are the ones a reader remembers. The red underline under "every screen" is the same hand as the
 * hero's. The command is the whole setup, as `guide/getting-started.md` gives it.
 */
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LandingCommand } from './command.ts';
import { CREATE_COMMAND, LINKS } from './content.ts';
import { underline } from './ink.ts';
import { LandingMark } from './mark.ts';

@Component({
  selector: 'landing-final-cta',
  imports: [LandingCommand, LandingMark, RouterLink],
  template: `
    <section class="border-t border-ink/15" aria-labelledby="cta-title">
      <div
        class="mx-auto flex max-w-[56rem] flex-col items-center px-[var(--gutter)] py-32 text-center"
      >
        <landing-mark class="size-14" />
        <h2
          id="cta-title"
          class="landing-display mt-8 text-[clamp(2.6rem,5.4vw,4.6rem)] text-balance"
        >
          Your Angular app belongs on
          <span class="relative inline-block"
            >every screen.<svg
              class="absolute -bottom-[0.14em] left-0 h-[0.22em] w-full overflow-visible"
              viewBox="0 0 100 10"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path class="ink-red ink-stretch cta-rule" [attr.d]="rule" /></svg
          ></span>
        </h2>
        <div class="mt-12 flex flex-wrap items-center justify-center gap-3">
          <a class="landing-button" data-kind="primary" [routerLink]="links.getStarted"
            >Get started</a
          >
          <a class="landing-button" data-kind="secondary" [routerLink]="links.docs"
            >Read the docs</a
          >
          <a class="landing-button" data-kind="secondary" [href]="links.github">Star on GitHub</a>
        </div>
        <landing-command class="mt-7 w-full max-w-[34rem]" [command]="command" />
        <p class="mt-10 text-sm text-graphite">
          Angular Native is free, MIT licensed and built in the open, with Coralogix as its steward.
        </p>
      </div>
    </section>
  `,
})
export class LandingFinalCta {
  protected readonly links = LINKS;
  protected readonly command = CREATE_COMMAND;
  protected readonly rule = underline(0, 6, 100, 404);
}
