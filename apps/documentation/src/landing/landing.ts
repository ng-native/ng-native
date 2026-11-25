/**
 * The landing page: an Angular engineer's notebook, in which Angular code becomes a native app.
 *
 * Outside the documentation shell on purpose - `app.ts` renders this route with no sidebar and
 * no docs header - and styled by `landing.css`, which `styles.css` imports so the prerendered
 * page is styled on its first paint rather than once this chunk arrives.
 *
 * Every phone on the page is a screenshot from the iOS simulator or the Android emulator running
 * the source shown beside it. Every source is the file's own text, highlighted at build
 * time. The facts live in `content.ts`; `README.md` says how to retake the screenshots.
 *
 * Each section is composed differently on purpose - windows and a phone on one desk, a sheet with
 * devices laid beside it, a row of four, index cards - so the page reads as a notebook of worked
 * examples rather than one template repeated. Near the end, a dark band introduces the people who
 * maintain the project at Coralogix.
 */
import { Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { html as planSource } from '../examples/plans.ts?excerpt';
import { html as settingsSource } from '../examples/settings.ts?excerpt';
import { Seo } from '../seo.ts';
import { GITHUB_REPO, SITE_NAME } from '../site.ts';
import { LandingCode } from './code-sheet.ts';
import { EXPO_APIS, LANDMARKS, LINKS } from './content.ts';
import { LandingPhone } from './phone.ts';
import { LandingExpoGlyph } from './expo-glyph.ts';
import { LandingFinalCta } from './final-cta.ts';
import { LandingFooter } from './footer.ts';
import { LandingHeader } from './header.ts';
import { LandingHero } from './hero.ts';
import { LandingMore } from './more.ts';
import { LandingReveal } from './reveal.ts';
import { observePast } from './scroll.ts';
import { LandingStewardship } from './stewardship.ts';

export const LANDING_TITLE = `${SITE_NAME} - Build native apps with Angular`;
export const LANDING_DESCRIPTION =
  'Build iOS, Android, macOS and Linux apps with Angular, powered by Expo: Angular components rendered as real native views, with a real CSS engine, Tailwind and native navigation.';

@Component({
  selector: 'doc-home',
  imports: [
    LandingCode,
    LandingPhone,
    LandingExpoGlyph,
    LandingFinalCta,
    LandingFooter,
    LandingHeader,
    LandingHero,
    LandingMore,
    LandingReveal,
    LandingStewardship,
    RouterLink,
  ],
  template: `
    <div class="landing">
      <a
        href="#main"
        class="sr-only z-50 rounded bg-ink px-4 py-2 text-paper-light focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <div class="landing-sentinel absolute top-0 h-2 w-px" aria-hidden="true"></div>
      <landing-header [solid]="scrolled()" [ruled]="pastHero()" />

      <main id="main">
        <landing-hero />
        <div class="h-px"></div>

        <!-- ================================================ Contents: the landmark features -->
        <section class="border-t border-ink/15" aria-labelledby="contents-title">
          <div class="mx-auto max-w-[80rem] px-[var(--gutter)] py-24">
            <div class="max-w-[46rem]" landingReveal>
              <p class="landing-eyebrow">Features</p>
              <h2 id="contents-title" class="landing-display mt-4 text-[clamp(2.2rem,4vw,3.2rem)]">
                What is in the box.
              </h2>
              <p class="landing-prose mt-5">
                Native UI on phones and desktops, CSS and Tailwind, navigation, component tests and
                Expo's modules, in the Angular you already know.
              </p>
            </div>
            <ol class="mt-12 grid grid-cols-1 gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
              @for (item of landmarks; track item.title; let i = $index) {
                <li landingReveal [style.--i]="i % 3">
                  @if (item.section; as section) {
                    <a class="contents-entry group" [href]="'#' + section">
                      <span class="pt-1 font-code text-sm text-ng-red-ink">{{ number(i) }}</span>
                      <span>
                        <span class="landing-display block text-xl group-hover:text-ng-red-ink"
                          >{{ item.title }}
                          @if (item.isNew) {
                            <span class="contents-new">New</span>
                          }
                        </span>
                        <span class="mt-1.5 block text-[0.9375rem] text-ink/70">{{
                          item.body
                        }}</span>
                      </span>
                    </a>
                  } @else {
                    <a class="contents-entry group" [routerLink]="item.docs">
                      <span class="pt-1 font-code text-sm text-ng-red-ink">{{ number(i) }}</span>
                      <span>
                        <span class="landing-display block text-xl group-hover:text-ng-red-ink"
                          >{{ item.title }}
                          @if (item.isNew) {
                            <span class="contents-new">New</span>
                          }
                        </span>
                        <span class="mt-1.5 block text-[0.9375rem] text-ink/70">{{
                          item.body
                        }}</span>
                      </span>
                    </a>
                  }
                </li>
              }
            </ol>
          </div>
        </section>

        <!-- ================================================ Platforms: windows and a phone on one desk -->
        <section
          id="desktop"
          class="scroll-mt-20 border-t border-ink/15 bg-paper-light/60"
          aria-labelledby="desktop-title"
        >
          <div class="mx-auto flex max-w-[80rem] flex-col gap-14 px-[var(--gutter)] py-28">
            <div class="grid grid-cols-1 items-end gap-x-14 gap-y-5 lg:grid-cols-2" landingReveal>
              <div>
                <p class="landing-eyebrow">Platforms</p>
                <h2 id="desktop-title" class="landing-display mt-4 text-[clamp(2.2rem,4vw,3.4rem)]">
                  Phones, tablets, and now the desktop.
                </h2>
              </div>
              <div>
                <p class="landing-prose">
                  The same Angular components run as native apps on macOS and Linux, with real
                  windows, menus, keyboard shortcuts and hover. Each platform draws them in its own
                  style, so your app looks at home on every one.
                </p>
                <landing-more class="mt-7" [link]="links.desktop" topic="desktop apps" />
              </div>
            </div>

            <!--
              Real captures, as everywhere on this page: two Angular Native apps on Linux and on
              macOS, and the settings screen from the Tailwind section on the iOS simulator.
            -->
            <figure class="desk" landingReveal style="--i: 1">
              <div class="desk-glow" aria-hidden="true"></div>
              <img
                class="desk-window"
                data-slot="linux"
                src="/desktop/linux-app.webp"
                alt="An Angular Native app on Linux, drawn with GTK 4 and libadwaita"
                width="1400"
                height="897"
                loading="lazy"
              />
              <img
                class="desk-window"
                data-slot="macos"
                src="/desktop/mac-app.webp"
                alt="An Angular Native app on macOS, drawn with AppKit"
                width="1400"
                height="897"
                loading="lazy"
              />
              <landing-phone
                class="desk-phone"
                platform="ios"
                shot="settings"
                alt="The settings screen on the iOS simulator"
              />
            </figure>
            <ul class="-mt-6 flex flex-wrap justify-center gap-x-10 gap-y-2" aria-hidden="true">
              <li class="device-label !mt-0">Linux · GTK 4</li>
              <li class="device-label !mt-0">macOS · AppKit</li>
              <li class="device-label !mt-0">iOS simulator</li>
            </ul>
          </div>
        </section>

        <!-- ================================================ CSS: a sheet with devices beside it -->
        <section id="css" class="scroll-mt-20 border-t border-ink/15" aria-labelledby="css-title">
          <div
            class="mx-auto grid grid-cols-1 max-w-[80rem] items-center gap-14 px-[var(--gutter)] py-28 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
          >
            <div landingReveal>
              <p class="landing-eyebrow">Styling</p>
              <h2 id="css-title" class="landing-display mt-4 text-[clamp(2.2rem,4vw,3.4rem)]">
                A CSS engine, compiled at build time.
              </h2>
              <p class="landing-prose mt-5">
                Write component styles in plain CSS. They compile when Metro bundles, then cascade
                over the native views the way a browser applies CSS to the DOM.
              </p>
              <p class="landing-prose mt-4">
                Selectors and combinators, <code>:host</code>, specificity and inheritance, custom
                properties, <code>&#64;media</code>, transitions, keyframes, gradients, shadows and
                filters.
              </p>
              <landing-more class="mt-7" [link]="links.supportedCss" topic="the CSS engine" />
            </div>

            <div class="relative" landingReveal style="--i: 1">
              <div class="relative z-10 lg:mr-[30%] lg:-rotate-[0.5deg]">
                <landing-code file="plans.ts" [html]="sources.plans" />
              </div>
              <div
                class="mt-8 grid grid-cols-2 gap-5 lg:absolute lg:top-6 lg:right-[9%] lg:mt-0 lg:block lg:w-[31%]"
              >
                <landing-phone
                  platform="ios"
                  shot="plans"
                  scheme="dark"
                  alt="An upgrade screen on the iOS simulator in dark mode, styled with component CSS"
                  class="relative z-20 lg:-rotate-[3deg]"
                />
                <landing-phone
                  platform="android"
                  shot="plans"
                  scheme="dark"
                  alt="The same screen on the Android emulator"
                  class="lg:absolute lg:top-16 lg:left-[46%] lg:w-full lg:rotate-[6deg]"
                />
              </div>
            </div>
          </div>
        </section>

        <!-- ================================================ Tailwind: the variants, then a row of four -->
        <section
          id="tailwind"
          class="scroll-mt-20 border-t border-ink/15 bg-paper-light/60"
          aria-labelledby="tailwind-title"
        >
          <div class="mx-auto max-w-[80rem] px-[var(--gutter)] py-28">
            <div class="grid grid-cols-1 items-start gap-14 lg:grid-cols-[0.95fr_1.05fr]">
              <div landingReveal>
                <p class="landing-eyebrow">Tailwind CSS v4</p>
                <h2
                  id="tailwind-title"
                  class="landing-display mt-4 text-[clamp(2.4rem,4.6vw,3.8rem)]"
                >
                  Tailwind, on iOS and Android.
                </h2>
                <p class="landing-prose mt-5">
                  Use the Tailwind you know. Layout, spacing, color, type, borders and gradients
                  compile to native styles, and the same classes work on the web.
                </p>
                <p class="landing-prose mt-4">
                  Add the native preset and connect Tailwind to Metro. A utility native can't draw
                  is reported at build time, with the line it came from.
                </p>
                <div class="mt-8 max-w-[30rem]">
                  <div class="code-sheet">
                    <div class="code-sheet-head">
                      <span class="code-sheet-file">styles.css</span>
                    </div>
                    <pre class="setup-body"><span>&#64;import 'tailwindcss/theme.css';</span>
<span>&#64;import 'tailwindcss/utilities.css';</span>
<span class="is-ours">&#64;import '&#64;ng-native/tailwind/native.css';</span></pre>
                  </div>
                </div>
                <landing-more class="mt-8" [link]="links.tailwind" topic="Tailwind" />
              </div>

              <div landingReveal style="--i: 1">
                <p class="landing-eyebrow">Plus the variants a device needs</p>
                <ul class="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  @for (variant of variants; track variant.name; let i = $index) {
                    <li
                      class="rounded-md bg-paper-light p-5 shadow-[var(--sheet-shadow)]"
                      landingReveal
                      [style.--i]="i % 2"
                    >
                      <p class="font-code text-lg text-ng-red-ink">{{ variant.name }}</p>
                      <p class="mt-2 text-[0.9375rem] text-ink/75">{{ variant.body }}</p>
                      <p class="mt-3 font-code text-xs text-graphite">{{ variant.example }}</p>
                    </li>
                  }
                </ul>
              </div>
            </div>

            <div class="mt-20 grid grid-cols-2 gap-6 md:grid-cols-4 md:gap-8">
              @for (shot of tailwindShots; track shot.label; let i = $index) {
                <figure landingReveal [style.--i]="i">
                  <div class="device-crop" style="--crop: 0.62">
                    <landing-phone
                      [platform]="shot.platform"
                      shot="settings"
                      [scheme]="shot.scheme"
                      [alt]="shot.alt"
                    />
                  </div>
                  <figcaption class="device-label">{{ shot.label }}</figcaption>
                </figure>
              }
            </div>
            <p class="mx-auto mt-10 max-w-[40rem] text-center text-[0.9375rem] text-ink/70">
              One template, four screens: iOS and Android, light and dark, from the
              <code>ios:</code>, <code>android:</code> and <code>dark:</code> classes below.
            </p>

            <div class="mx-auto mt-10 max-w-[52rem]" landingReveal>
              <landing-code file="settings.ts" [html]="sources.settings" />
            </div>
          </div>
        </section>

        <!-- ================================================ Expo: index cards -->
        <section id="expo" class="scroll-mt-20 border-t border-ink/15" aria-labelledby="expo-title">
          <div class="mx-auto max-w-[80rem] px-[var(--gutter)] py-28">
            <div class="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1fr] lg:items-start" landingReveal>
              <div>
                <p class="landing-eyebrow">The platform</p>
                <h2 id="expo-title" class="landing-display mt-4 text-[clamp(2.2rem,4vw,3.4rem)]">
                  Built on Expo.
                </h2>
              </div>
              <p class="landing-prose lg:pt-9">
                Develop in Expo Go, then build with <code>npx expo run:ios</code>,
                <code>npx expo run:android</code> or EAS, and use Expo's modules as Angular
                services, with signals wherever the device has a value to watch.
              </p>
            </div>
            <ul class="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              @for (api of expoApis; track api.name; let i = $index) {
                <li
                  class="min-w-0 rounded-md bg-paper-light p-6 shadow-[var(--sheet-shadow)]"
                  landingReveal
                  [style.--i]="i % 3"
                >
                  <landing-expo-glyph class="size-14" [name]="api.glyph" />
                  <h3 class="landing-display mt-5 text-xl">{{ api.name }}</h3>
                  <p class="mt-2 text-[0.9375rem] text-ink/70">{{ api.body }}</p>
                </li>
              }
            </ul>
            <landing-more class="mt-10" [link]="links.expo" topic="Expo modules" />
          </div>
        </section>

        <landing-stewardship />

        <landing-final-cta />
      </main>

      <landing-footer />
    </div>
  `,
})
export class Home {
  protected readonly links = LINKS;
  protected readonly landmarks = LANDMARKS;
  protected readonly expoApis = EXPO_APIS;
  protected readonly scrolled = signal(false);
  protected readonly pastHero = signal(false);
  protected readonly sources = {
    plans: planSource,
    settings: settingsSource,
  };
  protected readonly variants = [
    {
      name: 'ios:  android:',
      body: 'Per-platform styles in one class string.',
      example: 'ios:text-3xl android:rounded-full',
    },
    {
      name: 'dark:',
      body: 'Follows the system theme, or your own switcher.',
      example: 'bg-white dark:bg-zinc-950',
    },
    {
      name: 'hover:  press:',
      body: 'The press state on touch; real hover with a trackpad, mouse or pencil, once you turn on pointerEvents.',
      example: 'bg-red-600 hover:bg-red-700',
    },
    {
      name: 'web:  native:',
      body: 'Styles for the browser only, or the device only.',
      example: 'web:max-w-md native:flex-1',
    },
    {
      name: 'pt-safe',
      body: 'Padding and margins clear of the notch and home indicator.',
      example: 'pt-safe pb-safe-4',
    },
    {
      name: 'h-hairline',
      body: 'The thinnest line the screen can draw.',
      example: 'h-hairline bg-zinc-200',
    },
  ];
  protected readonly tailwindShots = [
    { platform: 'ios', scheme: 'light', label: 'iOS', alt: 'Settings on iOS, light' },
    { platform: 'android', scheme: 'light', label: 'Android', alt: 'Settings on Android, light' },
    { platform: 'ios', scheme: 'dark', label: 'iOS · dark', alt: 'Settings on iOS, dark' },
    {
      platform: 'android',
      scheme: 'dark',
      label: 'Android · dark',
      alt: 'Settings on Android, dark',
    },
  ] as const;
  constructor() {
    inject(Seo).apply({
      title: LANDING_TITLE,
      description: LANDING_DESCRIPTION,
      path: '/',
      type: 'website',
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'SoftwareSourceCode',
        name: SITE_NAME,
        description: LANDING_DESCRIPTION,
        codeRepository: GITHUB_REPO,
        programmingLanguage: 'TypeScript',
        license: 'https://opensource.org/licenses/MIT',
      },
    });

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      observePast('.landing-sentinel', (past) => this.scrolled.set(past), destroyRef);
      observePast('.landing main > .h-px', (past) => this.pastHero.set(past), destroyRef);
    });
  }

  /** A contents entry's number: 01, 02 and so on. */
  protected number(index: number): string {
    return String(index + 1).padStart(2, '0');
  }
}
