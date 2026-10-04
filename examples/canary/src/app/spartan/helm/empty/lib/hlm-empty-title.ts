import { Directive } from '@angular/core';
import { classes } from '../../utils';

@Directive({
  selector: '[hlmEmptyTitle]',
  host: { 'data-slot': 'empty-title' },
})
export class HlmEmptyTitle {
  constructor() {
    classes(() => 'spartan-empty-title');
  }
}
