/**
 * A native gesture, attached to the element it sits on.
 *
 * ```html
 * <view [gesture]="pan">
 * ```
 *
 * The equivalent of `GestureDetector`, which is a React component whose whole job is to hold a
 * ref, turn it into a view tag, and hand that tag to the native module. A directive already has
 * the node, and the engine already knows its tag.
 *
 * `NativeGesture` in `../gestures.ts` is the one apps import: same selector, and it supplies the
 * real library itself.
 */
import {
  Directive,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
} from '@angular/core';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { GESTURES, type EndedGesture, type GestureSpec } from './gesture-backend.ts';
import { gestureInteraction } from './gesture-interaction.ts';
import { booleanOr } from './transforms.ts';
import {
  INTERACTION_OBSERVERS,
  describeElement,
  notifyInteraction,
  textWithin,
  type InteractionObserver,
} from './interaction-observer.ts';

/**
 * The behaviour, with the library left as a dependency so a test can drive a fake one.
 *
 * `collapsable` is the load-bearing part of the host bindings. Native attaches a recogniser to a
 * *view*, and a view that only groups its children can be collapsed away by the renderer, leaving
 * a tag that resolves to nothing; the library retries a few times and then gives up silently, so
 * the gesture simply never fires. `GestureDetector` avoids it by cloning its child with
 * `collapsable: false`, and this is that, as a host binding. It runs after the host component's
 * own binding for the same prop, which is what makes it win.
 */
@Directive({ selector: '[gesture]', host: { '[collapsable]': 'false' } })
export class NativeGestureBase {
  private readonly node = inject(ElementRef).nativeElement as EngineNode;
  private readonly engine = inject(Engine);
  private readonly gestures = inject(GESTURES);
  private readonly injector = inject(Injector);
  private readonly observers = inject(INTERACTION_OBSERVERS, { optional: true });

  readonly gesture = input.required<GestureSpec>();
  /**
   * Whether the app's interaction observers hear this element's gestures. `false` keeps one out,
   * such as a drawing surface whose every stroke is not an interaction worth recording.
   */
  readonly trackGesture = input(true, { transform: booleanOr(true) });

  constructor() {
    // Native attaches a recogniser to a view, so there has to be one: a node has no react tag
    // until it has been committed.
    afterNextRender(() => {
      effect(
        (onCleanup) => {
          const gesture = this.gesture();
          const tag = this.engine.tagOf(this.node);
          if (tag === null) return;
          // Decided here, once per attach, so a gesture nobody observes costs nothing per event.
          const observers = this.trackGesture() && this.observers?.length ? this.observers : null;
          const report = observers
            ? (ended: EndedGesture) => this.report(observers, ended)
            : undefined;
          onCleanup(this.gestures.attach({ tag }, gesture, report));
        },
        { injector: this.injector },
      );
    });
  }

  /** Tell the observers about a gesture of this element's that has just ended. */
  private report(observers: readonly InteractionObserver[], ended: EndedGesture): void {
    const interaction = gestureInteraction(ended);
    if (!interaction) return;
    const pressed = interaction.type === 'click' || interaction.type === 'long-press';
    const text = pressed ? textWithin(this.node) : undefined;
    notifyInteraction(observers, {
      ...describeElement(this.engine, this.node),
      ...interaction,
      ...(text !== undefined && { text }),
      source: 'touch',
      timestamp: Date.now(),
    });
  }
}
