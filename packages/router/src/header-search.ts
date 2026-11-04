/**
 * Whether the header's search field is open, which its other items need to know on Android.
 *
 * There the open field covers the bar, and react-native-screens hides the header's other items
 * (`SearchBarView.setToolbarElementsVisibility`), which keep their last bounds. React Native finds
 * a touch's target by bounds alone, without looking at visibility, so a tap on the field also
 * pressed an item hidden under it. The search bar reports its `topOpen` and `topClose` here, and
 * the other items take no touches in between. iOS sends neither: its field sits under the title,
 * and UIKit's hit-testing skips hidden views.
 */
import { signal, type Provider } from '@angular/core';

/** One per header, which provides it to the items and the search bar written in it. */
export class HeaderSearch {
  readonly open = signal(false);
}

export const HEADER_SEARCH: Provider = {
  provide: HeaderSearch,
  useFactory: () => new HeaderSearch(),
};
