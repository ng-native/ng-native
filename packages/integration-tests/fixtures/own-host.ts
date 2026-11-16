import {
  Component,
  Directive,
  ElementRef,
  booleanAttribute,
  input,
  model,
  viewChild,
} from '@angular/core';
import { PressBehavior } from '../../components/src/pressable.ts';
import { View } from '../../components/src/view.ts';
import { ViewBase } from '../../components/src/view-base.ts';

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

/** A directive with a selector, whose inputs Angular has no public way to read. */
@Directive({ selector: '[xOwned]' })
export class OwnedDirective {
  readonly title = input<string>();
}

/** A directive with no selector, which only a `hostDirectives` entry can put on a node. */
@Directive({})
export class OwnedBehavior {
  readonly title = input<string>();
}

/** A host primitive that is a component rather than a directive, with an aliased input. */
@Component({ selector: 'x-owned-view', template: '' })
export class OwnedView extends ViewBase {
  readonly label = input('', { alias: 'caption' });
}

/** A component that takes `PressBehavior` and exposes none of its inputs. */
@Component({ selector: 'x-owned-press', template: '', hostDirectives: [PressBehavior] })
export class OwnedPress {}

/** Each kind of host, written with static attributes an input of the host consumes or not. */
@Component({
  selector: 'x-owned-hosts',
  imports: [View, OwnedView, OwnedPress],
  template: `
    <view #view testID="view" role="button" caption="kept"></view>
    <x-owned-view #component caption="Hi" role="button" heading="kept"></x-owned-view>
    <x-owned-press #behaviour delayPressIn="kept"></x-owned-press>
  `,
})
export class OwnedHosts {
  readonly view = viewChild.required('view', { read: ElementRef });
  readonly component = viewChild.required('component', { read: ElementRef });
  readonly behaviour = viewChild.required('behaviour', { read: ElementRef });
}
