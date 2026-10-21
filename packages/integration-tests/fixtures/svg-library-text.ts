import { Component } from '@angular/core';

/** A library's drawing with words in its text, as a chart writes a label. */
@Component({
  selector: 'x-svg-library-text',
  template: `<svg viewBox="0 0 10 10"><text testID="label" x="1" y="5">Hi</text></svg>`,
})
export class SvgLibraryText {}
