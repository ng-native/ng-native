import { Directive } from '@angular/core';
import { classes } from '../../utils';

@Directive({
  selector: 'kbd[hlmKbdGroup]',
  host: {
    'data-slot': 'kbd-group',
  },
})
export class HlmKbdGroup {
  constructor() {
    classes(() => 'spartan-kbd-group inline-flex items-center');
  }
}
