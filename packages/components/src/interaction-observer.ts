/**
 * The interaction observers live in `@ng-native/device`, so that `@ng-native/expo` and
 * `@ng-native/router` can report their controls too. Re-exported here, where the press machine
 * reads them and where apps import them from.
 */
export {
  INTERACTION_OBSERVERS,
  MAX_TEXT_LENGTH,
  describeElement,
  interactionObservers,
  notifyInteraction,
  provideInteractionObserver,
  textWithin,
  type InteractionDirection,
  type InteractionEvent,
  type InteractionGesture,
  type InteractionObserver,
  type InteractionType,
} from '@ng-native/device';

/**
 * How fast, in points per millisecond, a drag has to be moving as the finger lifts to be a swipe
 * rather than a scroll: a flick that leaves the content gliding on, not a drag set down.
 */
export const SWIPE_VELOCITY = 0.5;
