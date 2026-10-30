import { Component, Directive, booleanAttribute, input, model } from '@angular/core';

/**
 * A component with each kind of input `ownHost` must find by the name a template writes: a signal
 * input, an aliased one, one with a transform and a model.
 */
@Component({ selector: 'x-owned', template: '' })
export class Owned {
  readonly title = input<string>();
  readonly label = input('', { alias: 'caption' });
  readonly hidden = input(false, { transform: booleanAttribute });
  readonly value = model(0);
}

/** A directive, whose inputs Angular has no public way to read. */
@Directive({ selector: '[xOwned]' })
export class OwnedDirective {
  readonly title = input<string>();
}
