import { Directive } from '@angular/core';
import { classes } from '../../utils';

@Directive({ selector: '[hlmSelectValuesContent],hlm-select-values-content' })
export class HlmSelectValuesContent {
	constructor() {
		classes(() => 'spartan-select-values-content flex');
	}
}
