import { Directive } from '@angular/core';
import { HlmLabel } from '../../label';
import { classes } from '../../utils';

@Directive({
  selector: '[hlmFieldLabel],hlm-field-label',
  hostDirectives: [HlmLabel],
  host: { 'data-slot': 'field-label' },
})
export class HlmFieldLabel {
  constructor() {
    classes(() => [
      'spartan-field-label group/field-label peer/field-label flex w-fit',
      'has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col',
    ]);
  }
}
