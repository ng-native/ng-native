import { Component, ViewEncapsulation } from '@angular/core';

/**
 * The classes `/styled` hands `<markdown>`. Unencapsulated, so its sheet is a global one once it
 * renders, which is what reaches the elements `<markdown>` creates.
 */
@Component({
  selector: 'app-serif-theme',
  template: '',
  encapsulation: ViewEncapsulation.None,
  styles: `
    .serif-h1 {
      font-family: Georgia;
      font-size: 32px;
      line-height: 38px;
      font-weight: 700;
      color: light-dark(#8a3b12, #ffb38a);
    }

    .serif-h2 {
      font-family: Georgia;
      font-size: 22px;
      line-height: 28px;
      font-style: italic;
      color: light-dark(#8a3b12, #ffb38a);
    }

    .serif-p {
      font-family: Georgia;
      font-size: 17px;
      line-height: 26px;
      color: light-dark(#2b2118, #efe6dc);
    }

    .serif-a {
      font-weight: 700;
    }

    .serif-quote {
      padding: 12px 14px;
      border-radius: 10px;
      background-color: light-dark(#fbefe4, #3a2a1f);
      gap: 8px;
    }
  `,
})
export class SerifTheme {}
