import { Component, signal } from '@angular/core';
import { NgIcon } from '../../icons/src/ng-icon.ts';

/** A real heroicon, as `@ng-icons/heroicons` ships it: markup, `currentColor`, a CSS variable. */
export const heroAcademicCap =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" ' +
  'stroke="currentColor" aria-hidden="true" data-slot="icon" ' +
  'style="stroke-width:var(--ng-icon__stroke-width, 1.5)">' +
  '<path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.4 60.4 0 0 0-.49 6.35"/>' +
  '</svg>';

/**
 * Geometry rather than a path, which is how lucide draws half its set, and its stroke width in
 * the custom property ng-icons puts it in - copied from the real `lucideTarget`, with a polyline
 * added because no set here ships one and the conversion needs exercising.
 */
export const lucideTarget =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-linecap="round" ' +
  'style="stroke-width:var(--ng-icon__stroke-width, 2)">' +
  '<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle>' +
  '<polyline points="4,4 8,8 12,4"/>' +
  '</svg>';

@Component({
  selector: 'x-icon-host',
  imports: [NgIcon],
  template: `
    <ng-icon nativeID="named" name="hero-academic-cap" [size]="size()" [color]="color()" />
    <ng-icon nativeID="raw" [svg]="raw" [strokeWidth]="3" />
    <ng-icon nativeID="labelled" [svg]="odd()" accessibilityLabel="Target" />
    <ng-icon nativeID="static" [svg]="raw" size="32" />
    <ng-icon nativeID="inherited" name="constructor" />
    <div class="big"><ng-icon nativeID="by-font" [svg]="raw" /></div>
  `,
  styles: '.big { font-size: 20px }',
})
export class IconHost {
  readonly raw = lucideTarget;
  readonly size = signal(24);
  readonly color = signal('#ff9f0a');
  /** An element no native view draws, beside one that is drawn. */
  readonly odd = signal('<svg viewBox="0 0 24 24"><text>x</text><toString/><circle r="1"/></svg>');
}
