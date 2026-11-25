/**
 * The people behind the project: who maintains it, the community around them, and the one place
 * on the page that says what Coralogix makes, framed as something a reader shipping an app can
 * use. Dark in both themes, so it reads as a band of its own between the features and the end.
 */
import { Component } from '@angular/core';
import { avatar, COMMUNITY, LINKS, MAINTAINERS } from './content.ts';
import { CoralogixLogo } from './coralogix-logo.ts';
import { LandingReveal } from './reveal.ts';

@Component({
  selector: 'landing-stewardship',
  imports: [CoralogixLogo, LandingReveal],
  template: `
    <section id="stewardship" class="steward scroll-mt-20" aria-labelledby="steward-title">
      <div class="mx-auto flex max-w-[80rem] flex-col gap-16 px-[var(--gutter)] py-28">
        <div class="grid grid-cols-1 items-end gap-x-14 gap-y-6 lg:grid-cols-2" landingReveal>
          <div>
            <p class="landing-eyebrow !text-[#ff4d6d]">Stewardship</p>
            <h2 id="steward-title" class="landing-display mt-4 text-[clamp(2.2rem,4vw,3.4rem)]">
              The people behind Angular Native.
            </h2>
          </div>
          <div>
            <p class="text-[1.0625rem] leading-[1.65] text-[#f4f4f5]/72">
              Engineers at Coralogix maintain Angular Native, together with the community that built
              it. Everything happens in the open: in the issues, the discussions and every release.
            </p>
            <div class="mt-7 flex flex-wrap items-center gap-x-7 gap-y-4">
              <a class="steward-star" [href]="links.github">
                <svg class="size-[15px]" viewBox="0 0 16 16" aria-hidden="true">
                  <path fill="currentColor" [attr.d]="githubMark" />
                </svg>
                <span>Star on GitHub</span>
                <span class="steward-count">
                  <svg class="size-3.5" viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M8 .8l2.2 4.6 5 .6-3.7 3.5.9 5L8 12.1 3.6 14.5l.9-5L.8 6l5-.6z"
                    />
                  </svg>
                  {{ community.stars }}<span class="sr-only"> stars</span>
                </span>
              </a>
              <a class="steward-quiet" [href]="links.discussions">
                Discussions
                <svg class="size-3" viewBox="0 0 16 16" aria-hidden="true">
                  <path [attr.d]="outArrow" fill="none" stroke="currentColor" stroke-width="1.6" />
                </svg>
              </a>
              <a class="steward-quiet" [href]="links.releases">
                Releases
                <svg class="size-3" viewBox="0 0 16 16" aria-hidden="true">
                  <path [attr.d]="outArrow" fill="none" stroke="currentColor" stroke-width="1.6" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        <ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          @for (person of maintainers; track person.github; let i = $index) {
            <li landingReveal [style.--i]="i">
              <a class="steward-card" [href]="'https://github.com/' + person.github">
                <img
                  class="steward-avatar"
                  [src]="avatar(person.github)"
                  alt=""
                  width="56"
                  height="56"
                  loading="lazy"
                />
                <span>
                  <span class="landing-display block text-xl">{{ person.name }}</span>
                  <span class="mt-1 block text-sm text-[#9a9ba3]"
                    >{{ person.role }} · Coralogix</span
                  >
                </span>
                <span class="steward-foot">
                  <svg class="size-[15px]" viewBox="0 0 16 16" aria-hidden="true">
                    <path fill="currentColor" [attr.d]="githubMark" />
                  </svg>
                  {{ person.github }}
                  <svg class="steward-arrow size-[13px]" viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      [attr.d]="outArrow"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                    />
                  </svg>
                </span>
              </a>
            </li>
          }
          <li landingReveal [style.--i]="maintainers.length">
            <a class="steward-card" [href]="links.contributors">
              <span class="flex h-14 items-center pl-2.5" aria-hidden="true">
                @for (handle of community.avatars; track handle) {
                  <img
                    class="steward-face"
                    [src]="avatar(handle)"
                    alt=""
                    width="36"
                    height="36"
                    loading="lazy"
                  />
                }
              </span>
              <span>
                <span class="landing-display block text-xl"
                  >{{ community.moreContributors }} more contributors</span
                >
                <span class="mt-1 block text-sm text-[#9a9ba3]">From the community</span>
              </span>
              <span class="steward-foot">
                <svg class="size-[15px]" viewBox="0 0 16 16" aria-hidden="true">
                  <path fill="currentColor" [attr.d]="githubMark" />
                </svg>
                All contributors
                <svg class="steward-arrow size-[13px]" viewBox="0 0 16 16" aria-hidden="true">
                  <path [attr.d]="outArrow" fill="none" stroke="currentColor" stroke-width="1.6" />
                </svg>
              </span>
            </a>
          </li>
        </ul>

        <!-- The one product mention, framed as useful to the reader. -->
        <div class="steward-banner" landingReveal>
          <cx-logo class="h-[22px]" tone="light" />
          <span class="hidden w-px self-stretch bg-[#f4f4f5]/12 sm:block" aria-hidden="true"></span>
          <p class="min-w-0 flex-[1_1_26rem] text-[0.9375rem] leading-[1.6] text-[#f4f4f5]/70">
            <strong class="mb-0.5 block text-base font-semibold text-[#f4f4f5]"
              >Shipping an Angular Native app?</strong
            >
            See crashes, slow screens and real user sessions next to your backend's logs and traces,
            with Coralogix.
          </p>
          <a class="steward-explore" [href]="links.coralogix">
            Explore Coralogix
            <svg class="size-3.5" viewBox="0 0 16 16" aria-hidden="true">
              <path [attr.d]="outArrow" fill="none" stroke="currentColor" stroke-width="1.6" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  `,
  styles: `
    .steward {
      background: #0a0a0b;
      color: #f4f4f5;
      border-block: 1px solid rgb(244 244 245 / 0.08);
    }
    .steward path[stroke] {
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .steward-star {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      height: 2.25rem;
      padding: 0 0.25rem 0 0.75rem;
      border-radius: 0.5rem;
      background: #f4f4f5;
      color: #0a0a0b;
      font-size: 0.875rem;
      font-weight: 600;
      transition: background-color 150ms;
    }
    .steward-star:hover {
      background: #fff;
    }
    .steward-count {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      height: 1.75rem;
      padding: 0 0.5rem;
      margin-left: 0.125rem;
      border-radius: 0.3rem;
      background: rgb(10 10 11 / 0.08);
      font-size: 0.8125rem;
      font-variant-numeric: tabular-nums;
    }
    .steward-quiet {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.875rem;
      color: rgb(244 244 245 / 0.72);
      transition: color 150ms;
    }
    .steward-quiet:hover {
      color: #f4f4f5;
    }
    .steward-card {
      display: flex;
      flex-direction: column;
      gap: 0.875rem;
      height: 100%;
      padding: 1.5rem;
      border-radius: 0.625rem;
      border: 1px solid rgb(244 244 245 / 0.08);
      background: #141416;
      transition:
        border-color 150ms,
        background-color 150ms;
    }
    .steward-card:hover {
      background: #19191c;
      border-color: rgb(244 244 245 / 0.16);
    }
    .steward-avatar {
      display: block;
      width: 3.5rem;
      height: 3.5rem;
      border-radius: 50%;
      box-shadow: 0 0 0 1px rgb(244 244 245 / 0.12);
    }
    .steward-face {
      display: block;
      width: 2.25rem;
      height: 2.25rem;
      margin-left: -0.625rem;
      border-radius: 50%;
      box-shadow: 0 0 0 2px #141416;
    }
    .steward-foot {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: auto;
      padding-top: 0.875rem;
      border-top: 1px solid rgb(244 244 245 / 0.08);
      font-size: 0.875rem;
      font-weight: 500;
      color: rgb(244 244 245 / 0.6);
      transition: color 150ms;
    }
    .steward-arrow {
      margin-left: auto;
      opacity: 0.5;
      transition: opacity 150ms;
    }
    .steward-card:hover .steward-foot {
      color: #f4f4f5;
    }
    .steward-card:hover .steward-arrow {
      opacity: 1;
    }
    .steward-banner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 1rem 1.5rem;
      padding: 1.375rem 1.75rem;
      border-radius: 0.75rem;
      border: 1px solid rgb(62 207 142 / 0.18);
      background:
        radial-gradient(80% 220% at 100% 0%, rgb(19 233 137 / 0.12), rgb(19 233 137 / 0) 60%),
        #111113;
    }
    .steward-explore {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.625rem 1rem;
      border-radius: 0.5rem;
      border: 1px solid rgb(62 207 142 / 0.45);
      color: #3ecf8e;
      font-size: 0.9375rem;
      font-weight: 600;
      transition: background-color 150ms;
    }
    .steward-explore:hover {
      background: rgb(62 207 142 / 0.1);
    }
    .steward :focus-visible {
      outline-color: #f4f4f5;
    }
  `,
})
export class LandingStewardship {
  protected readonly links = LINKS;
  protected readonly maintainers = MAINTAINERS;
  protected readonly community = COMMUNITY;
  protected readonly avatar = avatar;
  protected readonly outArrow = 'M5 11 11 5M6 5h5v5';
  protected readonly githubMark =
    'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';
}
