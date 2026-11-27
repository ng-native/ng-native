/**
 * Coralogix's official logo, from `public/brand`, never redrawn.
 *
 * Two files, because the wordmark is ink on a light ground and white on a dark one. `auto`
 * follows the site's theme; `light` is for a ground that is dark in both themes, such as the
 * landing page's stewardship section. Height comes from the host's class; the width follows.
 */
import { Component, input } from '@angular/core';

@Component({
  selector: 'cx-logo',
  template: `
    @if (tone() === 'light') {
      <img
        class="block"
        src="/brand/coralogix-light.svg"
        alt="Coralogix"
        width="1018"
        height="221"
      />
    } @else {
      <img
        class="block dark:hidden"
        src="/brand/coralogix.svg"
        alt="Coralogix"
        width="1018"
        height="221"
      />
      <img
        class="hidden dark:block"
        src="/brand/coralogix-light.svg"
        alt="Coralogix"
        width="1018"
        height="221"
      />
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    img {
      height: 100%;
      width: auto;
    }
  `,
})
export class CoralogixLogo {
  readonly tone = input<'auto' | 'light'>('auto');
}
