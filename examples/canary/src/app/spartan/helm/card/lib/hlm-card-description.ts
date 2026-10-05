import { Directive } from '@angular/core';
import { classes } from '../../utils';

@Directive({
  selector: '[hlmCardDescription]',
  host: { 'data-slot': 'card-description' },
})
export class HlmCardDescription {
  constructor() {
    classes(() => 'spartan-card-description');
  }
}
