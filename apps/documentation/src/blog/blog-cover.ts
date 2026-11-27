/**
 * The announcement's cover: the two marks side by side on a dark, gridded ground lit red from
 * one corner and green from the other. Dark in both themes.
 */
import { Component, input } from '@angular/core';
import { CoralogixLogo } from '../landing/coralogix-logo.ts';
import { LandingMark } from '../landing/mark.ts';

@Component({
  selector: 'blog-cover',
  imports: [CoralogixLogo, LandingMark],
  template: `
    @if (tag(); as label) {
      <span class="cover-chip">{{ label }}</span>
    }
    <div class="cover-glow" aria-hidden="true"></div>
    <div class="cover-grid" aria-hidden="true"></div>
    <div class="cover-lockup">
      <span class="flex items-center gap-[0.43em]">
        <landing-mark class="cover-mark" />
        <span class="landing-display">Angular Native</span>
      </span>
      <span class="cover-rule" aria-hidden="true"></span>
      <cx-logo class="cover-cx" tone="light" />
    </div>
  `,
  host: { class: 'blog-cover' },
  styles: `
    :host {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      aspect-ratio: 16 / 9;
      border-radius: 0.875rem;
      background: #0e0e10;
      color: #f4f4f5;
      container-type: inline-size;
    }
    .cover-glow {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(60% 90% at 12% 100%, rgb(228 0 53 / 0.38), rgb(228 0 53 / 0) 70%),
        radial-gradient(55% 80% at 92% 0%, rgb(19 233 137 / 0.22), rgb(19 233 137 / 0) 70%);
    }
    .cover-grid {
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(rgb(244 244 245 / 0.05) 1px, transparent 1px),
        linear-gradient(90deg, rgb(244 244 245 / 0.05) 1px, transparent 1px);
      background-size: 44px 44px;
      mask-image: radial-gradient(70% 70% at 50% 50%, #000, transparent);
    }
    .cover-chip {
      position: absolute;
      top: 1rem;
      left: 1rem;
      z-index: 2;
      display: inline-flex;
      align-items: center;
      height: 1.625rem;
      padding: 0 0.7rem;
      border-radius: 999px;
      background: #fff;
      color: #171817;
      font-size: 0.78rem;
      font-weight: 600;
      box-shadow:
        0 1px 2px rgb(0 0 0 / 0.12),
        0 4px 12px -4px rgb(0 0 0 / 0.25);
    }
    /* Everything in em, from a size that follows the cover's width. */
    .cover-lockup {
      position: relative;
      display: flex;
      align-items: center;
      gap: 0.8em;
      font-size: clamp(0.9rem, 5.4cqi, 2.1rem);
    }
    .cover-mark {
      width: 1.8em;
      height: 1.8em;
    }
    .cover-rule {
      width: 1px;
      height: 1.8em;
      background: rgb(244 244 245 / 0.25);
    }
    .cover-cx {
      height: 1.55em;
    }
  `,
})
export class BlogCover {
  readonly tag = input<string>();
}
