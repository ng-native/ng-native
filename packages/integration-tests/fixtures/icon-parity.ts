import { Component, signal } from '@angular/core';
import { provideNgIconsConfig } from '@ng-icons/core';
import { NgIcon } from '../../icons/src/ng-icon.ts';
import { View } from '../../components/src/view.ts';

/** Copied from `@ng-icons/lets-icons/duotone-line`: a full-box path cut to shape by a mask. */
export const letsAddDuotoneLine =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><mask id="ID_PLACEHOLDER_0">' +
  '<g fill="none" style="stroke-width:var(--ng-icon__stroke-width, 1.2)">' +
  '<circle cx="12" cy="12" r="8.4" stroke="silver" stroke-opacity=".25"></circle>' +
  '<path stroke="#fff" stroke-linecap="square" d="M12 8v8m4-4H8"></path></g></mask></defs>' +
  '<path fill="currentColor" d="M0 0h24v24H0z" mask="url(#ID_PLACEHOLDER_0)"></path></svg>';

/** Copied from `@ng-icons/flag-icons/square`, with two of its five stars: a star drawn by `<use>`. */
export const flagCnSquare =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
  'id="ID_PLACEHOLDER_0" viewBox="0 0 512 512"><defs>' +
  '<path id="ID_PLACEHOLDER_1" fill="#ff0" d="M1-.3-.7.8 0-1 .6.8-1-.3z"></path></defs>' +
  '<path fill="#ee1c25" d="M0 0h512v512H0z"></path>' +
  '<use xlink:href="#ID_PLACEHOLDER_1" width="30" height="20" transform="translate(128 128)scale(76.8)"></use>' +
  '<use href="#ID_PLACEHOLDER_1" x="4" transform="matrix(16 -19.968 19.968 16 256 230.4)"></use></svg>';

/** Copied from `@ng-icons/flag-icons/square`: artwork wider than the flag, clipped to it. */
export const flagSlSquare =
  '<svg xmlns="http://www.w3.org/2000/svg" id="ID_PLACEHOLDER_0" viewBox="0 0 512 512"><defs>' +
  '<clipPath id="ID_PLACEHOLDER_1"><rect width="384" height="512" rx="4.6" ry="7.6"></rect></clipPath></defs>' +
  '<g fill-rule="evenodd" clip-path="url(#ID_PLACEHOLDER_1)" transform="scale(1.33333 1)">' +
  '<path fill="#0000cd" d="M0 341.7h512V512H0z"></path><path fill="#fff" d="M0 171.4h512v170.3H0z"></path>' +
  '<path fill="#00cd00" d="M0 0h512v171.4H0z"></path></g></svg>';

const square =
  '<svg viewBox="0 0 24 24" style="stroke-width:var(--ng-icon__stroke-width, 2)"><rect width="24" height="24"/></svg>';

/** Icons whose markup uses a mask, a `<use>` and a clip path. */
@Component({
  selector: 'x-icon-masks',
  imports: [NgIcon],
  template: `
    <ng-icon nativeID="duotone" [svg]="duotone" />
    <ng-icon nativeID="china" [svg]="china" />
    <ng-icon nativeID="sierra-leone" [svg]="sierraLeone" />
  `,
})
export class IconMasks {
  readonly duotone = letsAddDuotoneLine;
  readonly china = flagCnSquare;
  readonly sierraLeone = flagSlSquare;
}

/** Icons under `provideNgIconsConfig`, with and without inputs of their own. */
@Component({
  selector: 'x-icon-config',
  imports: [NgIcon],
  providers: [provideNgIconsConfig({ size: '20px', color: '#123456', strokeWidth: 3 })],
  template: `
    <ng-icon nativeID="configured" [svg]="square" />
    <ng-icon nativeID="own" [svg]="square" size="12" color="#654321" [strokeWidth]="1" />
  `,
})
export class IconConfig {
  readonly square = square;
}

/** What ng-icons reads from around an icon: a colour token, an `aria-label`, a stack's size. */
@Component({
  selector: 'x-icon-surroundings',
  imports: [NgIcon, View],
  template: `
    <view style="--accent: #0a84ff">
      <ng-icon nativeID="token-colour" [svg]="square" color="var(--accent)" />
    </view>
    <ng-icon nativeID="aria" [svg]="square" aria-label="Close" />
    <view style="--ng-icon__size: 32px">
      <ng-icon nativeID="stacked" [svg]="square" />
    </view>
  `,
})
export class IconSurroundings {
  readonly square = square;
}

/** Icons no `provideIcons` has, for a loader to find. */
@Component({
  selector: 'x-icon-loader',
  imports: [NgIcon],
  template: `
    <ng-icon nativeID="string" name="string-icon" />
    <ng-icon nativeID="promise" name="promise-icon" />
    <ng-icon nativeID="observable" name="observable-icon" />
    <ng-icon nativeID="promise-again" name="promise-icon" />
    <ng-icon nativeID="swapped" [name]="swapped()" />
    <ng-icon nativeID="empty" name="empty-icon" />
    <ng-icon nativeID="broken" name="broken-icon" />
  `,
})
export class IconLoader {
  readonly swapped = signal('slow-icon');
}

/** One icon whose name changes, for a loader that answers out of order. */
@Component({
  selector: 'x-icon-swap',
  imports: [NgIcon],
  template: `<ng-icon nativeID="swap" [name]="name()" />`,
})
export class IconSwap {
  readonly name = signal('a-icon');
}
