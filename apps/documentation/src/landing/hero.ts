/**
 * The hero: the claim, and one Angular app on every screen it reaches.
 *
 * Four captures in an arc along the bottom edge: an app on Linux and one on macOS, then the
 * player on the iOS simulator and the fitness tracker on the Android emulator. Every one is a
 * screenshot of real native views (see `README.md`); the desktop captures are in
 * `public/desktop`. The arc is laid out as shares of one wide stage, so it keeps its shape from a
 * laptop to a phone, where the stage is wider than the screen and its outer windows are cropped.
 */
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LINKS } from './content.ts';
import { CoralogixLogo } from './coralogix-logo.ts';
import { prefersReducedMotion, underline } from './ink.ts';
import { LandingPhone } from './phone.ts';

@Component({
  selector: 'landing-hero',
  imports: [CoralogixLogo, LandingPhone, RouterLink],
  template: `
    <section
      class="relative overflow-hidden"
      [class.hero-intro]="intro"
      aria-labelledby="hero-title"
    >
      <div class="mx-auto max-w-[80rem] px-[var(--gutter)] pt-12 text-center lg:pt-14">
        <p class="landing-eyebrow hero-rise" style="--i: 0">Now on macOS and Linux</p>
        <h1
          id="hero-title"
          class="landing-display mt-[1.125rem] text-[clamp(2.5rem,5.3vw,4.75rem)] text-balance"
        >
          <span class="hero-rise inline-block" style="--i: 1">One Angular app.</span>&ngsp;<span
            class="hero-rise relative inline-block"
            style="--i: 2"
            >Every screen.<svg
              class="absolute -bottom-[0.12em] left-0 h-[0.2em] w-full overflow-visible"
              viewBox="0 0 100 10"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path class="ink-red ink-stretch hero-thread" [attr.d]="headlineRule" /></svg
          ></span>
        </h1>
        <p
          class="landing-prose hero-rise mx-auto mt-6 max-w-[46rem] text-[1.0625rem] sm:text-lg"
          style="--i: 3"
        >
          Angular components rendered as real native views on iOS, Android, macOS and Linux.
          Templates, signals, CSS and Tailwind, as you write them on the web.
        </p>

        <div class="hero-rise mt-7 flex flex-wrap justify-center gap-3" style="--i: 4">
          <a class="landing-button" data-kind="primary" [routerLink]="links.getStarted">
            Get started
            <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true">
              <path
                d="M3 8h9.5M9 4.5 12.5 8 9 11.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </a>
          <a class="landing-button" data-kind="secondary" [href]="links.github">View on GitHub</a>
        </div>

        <a
          class="hero-rise mx-auto mt-6 flex w-max items-center gap-3 text-sm text-graphite transition-colors hover:text-ink"
          style="--i: 5"
          href="/#stewardship"
        >
          Maintained by <cx-logo class="h-6" />
        </a>
      </div>

      <!--
        One app on every screen: each is a capture of real native views, never a mock. The two
        windows are Angular Native apps on Linux (GTK 4 and libadwaita) and on macOS.
      -->
      <figure class="hero-stage">
        <img
          class="hero-device hero-window"
          data-slot="linux"
          src="/desktop/linux-app.webp"
          alt="Homestead, a homelab monitor built with Angular Native, running on Linux"
          width="1400"
          height="897"
          fetchpriority="high"
        />
        <img
          class="hero-device hero-window"
          data-slot="macos"
          src="/desktop/mac-app.webp"
          alt="Margin, a notes app built with Angular Native, running on macOS"
          width="1400"
          height="897"
          fetchpriority="high"
        />
        <landing-phone
          class="hero-device"
          data-slot="ios"
          platform="ios"
          shot="player"
          alt="A music player with drawn sunset album art, a scrubber and playback controls, on iOS"
          [eager]="true"
        />
        <landing-phone
          class="hero-device"
          data-slot="android"
          platform="android"
          shot="fitness"
          alt="A fitness summary with activity rings and a map of an evening run, on Android"
          [eager]="true"
        />
      </figure>
    </section>
  `,
})
export class LandingHero {
  protected readonly links = LINKS;

  /**
   * Whether the load sequence runs. Never under reduced motion, where everything is drawn - and
   * not if the page has already painted: that is the prerendered copy, which played the sequence
   * itself on first paint, and the client taking over must not play it a second time.
   */
  protected readonly intro =
    !prefersReducedMotion() &&
    !performance.getEntriesByType('paint').some((entry) => entry.name === 'first-contentful-paint');

  protected readonly headlineRule = underline(0, 6, 100, 11);
}
