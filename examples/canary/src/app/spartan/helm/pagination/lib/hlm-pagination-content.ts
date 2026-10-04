import { Directive } from '@angular/core';
import { classes } from '../../utils';

@Directive({
  selector: 'ul[hlmPaginationContent]',
  host: { 'data-slot': 'pagination-content' },
})
export class HlmPaginationContent {
  constructor() {
    classes(() => 'spartan-pagination-content flex items-center');
  }
}
