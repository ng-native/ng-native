/**
 * How the `ui-*` controls tell the app's interaction observers about a tap. SwiftUI and Compose
 * draw them, so no press machine sees them: each reports from the native event it already turns
 * into an output, as a `click` with no value, since what a control was set to can be user data.
 */
import { DestroyRef, ElementRef, Injector, afterNextRender, inject } from '@angular/core';
import {
  type InteractionEvent,
  MAX_TEXT_LENGTH,
  describeElement,
  interactionObservers,
  notifyInteraction,
} from '@ng-native/device';
import { HostEngine, type HostNode, type NativeSyntheticEvent } from '@ng-native/fabric';

/** What a control adds to the event, read as it is reported. */
type Extra = () => Partial<Pick<InteractionEvent, 'label' | 'role' | 'text'>>;

/**
 * A function that reports one click on the component's host. Observers are looked up when it is
 * called, so a control costs nothing until it is tapped in an app that has some.
 */
export function clickReporter(extra?: Extra): () => void {
  const node = inject(ElementRef).nativeElement as HostNode;
  const engine = node.engine ?? inject(HostEngine);
  const injector = inject(Injector);
  return () => {
    const observers = interactionObservers(injector);
    if (!observers) return;
    const added = extra?.();
    notifyInteraction(observers, {
      type: 'click',
      ...describeElement(engine, node),
      ...added,
      ...(added?.text && { text: added.text.slice(0, MAX_TEXT_LENGTH) }),
      source: 'click',
      timestamp: Date.now(),
    });
  };
}

/**
 * Report a click each time the host's native `event` arrives and `isClick` takes it. Listened for
 * once the component has rendered, so it runs after every listener the template put on the element:
 * an output SwiftUI sends straight to the app, such as `(buttonPress)`, has run by then.
 */
export function reportClicksOn(
  event: string,
  isClick: (payload: Record<string, unknown>) => boolean = () => true,
  extra?: Extra,
): void {
  const report = clickReporter(extra);
  const node = inject(ElementRef).nativeElement as HostNode;
  const engine = node.engine ?? inject(HostEngine);
  const destroyRef = inject(DestroyRef);
  afterNextRender(() => {
    destroyRef.onDestroy(
      engine.setEventListener(node, event, (raw) => {
        if (isClick((raw as NativeSyntheticEvent<Record<string, unknown>>)?.nativeEvent ?? {})) {
          report();
        }
      }),
    );
  });
}
