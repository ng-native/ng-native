/**
 * Fixture for `svg.test.ts`. See `button-app.ts`'s doc comment for why a `@Component` lives out
 * here rather than in the test file.
 *
 * `NgIcon`'s own `svg` input takes markup straight, which is enough to exercise
 * `parse-svg.ts` -> `svg-props.ts`'s translation without `provideIcons` or a real `@ng-icons`
 * package.
 *
 * The icon markup is deliberately shaped like a real outline icon (heroicons/lucide's own
 * convention): `fill="none" stroke="currentColor"` on the root, inherited by a `path` that
 * declares neither itself, alongside a `circle` and a `rect` that each override the inherited
 * paint - `fill="none"` on the `rect` explicitly re-declares "nothing", which is the exact case
 * `dom-node.ts`'s `SVG_BRUSH_ELEMENTS` seeding exists for (see that file's doc comment). The
 * `line` is here only so `elements.ts`'s `svg-line` entry - the one shape name nothing else in
 * this markup exercises - still commits as a real, namespaced `<line>`.
 */
import { Component } from '@angular/core';
import { NgIcon } from '@ng-native/icons';

const ICON_MARKUP = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M4 4h16v16H4z" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="12" cy="12" r="3" fill="#ff9f0a" fill-rule="evenodd" clip-rule="evenodd" />
    <rect x="2" y="2" width="4" height="4" fill="none" stroke-dasharray="4 2" transform="translate(3,4)" />
    <line x1="2" y1="20" x2="22" y2="20" stroke="#e5e7eb" />
  </svg>
`;

/** A wordmark: a gradient in defs, and text filled with it, one span of it in a colour of its own. */
const WORDMARK_MARKUP = `
  <svg viewBox="0 0 96 24">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1,2)">
        <stop offset="0" stop-color="#437dfc" />
        <stop offset="100%" stop-color="currentColor" stop-opacity="0.5" />
      </linearGradient>
      <radialGradient id="r" r="40%"><stop offset="0" stop-color="#ff0000" /></radialGradient>
    </defs>
    <text x="0 9" y="18" font-size="17" font-weight="600" font-family="'Inter', sans-serif" fill="url(#g)">We<tspan fill="none" dy="2">ek</tspan></text>
  </svg>
`;

@Component({
  selector: 'app-root',
  imports: [NgIcon],
  template: `
    <ng-icon id="icon-root" [svg]="markup" [size]="32" color="#111827" />
    <ng-icon id="wordmark" [svg]="wordmark" color="#4ad0ef" />
  `,
})
export class SvgApp {
  readonly markup = ICON_MARKUP;
  readonly wordmark = WORDMARK_MARKUP;
}
