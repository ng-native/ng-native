/**
 * The card under a docs page's contents that points to the Monitoring guide: Coralogix's logo, a
 * line worded for the page it is on, and what monitoring gets you. Not on the Monitoring page.
 */
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LINKS } from './landing/content.ts';
import { CoralogixLogo } from './landing/coralogix-logo.ts';

const COPY: Record<string, { title: string; text: string }> = {
  'guide/getting-started': {
    title: 'Know when your app breaks',
    text: 'Find out what your users hit, before your reviews do.',
  },
  'guide/deployment': {
    title: 'Shipping a release?',
    text: 'See how it runs for real users, from the first launch.',
  },
};

const DEFAULT_COPY = {
  title: 'See how your app runs in production',
  text: 'Find out what your users hit, before your reviews do.',
};

@Component({
  selector: 'doc-monitoring-card',
  imports: [CoralogixLogo, RouterLink],
  template: `
    <a class="cx-card" [routerLink]="link">
      <cx-logo class="h-[18px]" />
      <span
        class="mt-3.5 block font-display text-[17px] leading-tight font-semibold tracking-[-0.015em] text-fg"
      >
        {{ copy().title }}
      </span>
      <span class="mt-1.5 block text-[13px] leading-normal text-fg-secondary">{{
        copy().text
      }}</span>
      <ul class="mt-3.5 flex flex-col gap-[7px] text-[13px] text-fg">
        @for (feature of features; track feature) {
          <li class="flex items-center gap-2">
            <svg class="size-3.5 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="8" fill="#13e989" fill-opacity=".16" />
              <path
                class="cx-tick"
                d="m5 8.2 2 2 4-4.4"
                fill="none"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {{ feature }}
          </li>
        }
      </ul>
      <span class="cx-card-cta">
        Read the guide
        <svg class="size-3.5" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M3 8h9.5M9 4.5 12.5 8 9 11.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    </a>
  `,
  host: { class: 'block' },
  styles: `
    .cx-card {
      display: block;
      padding: 1rem;
      border-radius: 14px;
      border: 1px solid var(--border-subtle);
      background:
        radial-gradient(110% 55% at 100% 0%, rgb(19 233 137 / 0.2), rgb(19 233 137 / 0) 70%),
        radial-gradient(80% 45% at 0% 0%, rgb(134 255 201 / 0.22), rgb(134 255 201 / 0) 70%),
        var(--surface-page);
      transition: border-color 0.2s;
    }
    .cx-card:hover {
      border-color: rgb(2 118 58 / 0.3);
    }
    .cx-tick {
      stroke: #02763a;
    }
    .cx-card-cta {
      margin-top: 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 34px;
      border-radius: 8px;
      background: #171817;
      color: #fafafa;
      font-size: 13px;
      font-weight: 550;
      transition: background-color 0.15s;
    }
    .cx-card:hover .cx-card-cta {
      background: #000;
    }
    .cx-card-cta svg {
      transition: transform 0.15s;
    }
    .cx-card:hover .cx-card-cta svg {
      transform: translateX(2px);
    }
    :host-context(.dark) .cx-card {
      background:
        radial-gradient(110% 55% at 100% 0%, rgb(19 233 137 / 0.12), rgb(19 233 137 / 0) 70%),
        radial-gradient(80% 45% at 0% 0%, rgb(134 255 201 / 0.07), rgb(134 255 201 / 0) 70%),
        rgb(255 255 255 / 0.03);
    }
    :host-context(.dark) .cx-card:hover {
      border-color: rgb(62 207 142 / 0.35);
    }
    :host-context(.dark) .cx-tick {
      stroke: #3ecf8e;
    }
    :host-context(.dark) .cx-card-cta {
      background: #f4f4f5;
      color: #0a0a0b;
    }
    :host-context(.dark) .cx-card:hover .cx-card-cta {
      background: #fff;
    }
  `,
})
export class DocMonitoringCard {
  /** The page it is on, as its path without a leading slash. */
  readonly page = input.required<string>();

  protected readonly link = LINKS.monitoring;
  protected readonly copy = computed(() => COPY[this.page()] ?? DEFAULT_COPY);
  protected readonly features = [
    'Crashes and errors',
    'Startup and frame timings',
    'Session Replay',
  ];
}
