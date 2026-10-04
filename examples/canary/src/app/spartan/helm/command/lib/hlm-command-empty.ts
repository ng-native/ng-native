import { Directive } from '@angular/core';
import { classes } from '../../utils';

@Directive({
  selector: '[hlmCommandEmpty]',
  host: {
    'data-slot': 'command-empty',
  },
})
export class HlmCommandEmpty {
  constructor() {
    classes(() => 'spartan-command-empty');
  }
}
