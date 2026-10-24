/**
 * `<ui-bottom-sheet-view>`: `@expo/ui`'s sheet itself, with each platform's props typed.
 *
 * `UiBottomSheet` in `expo-ui-components.ts` is the component an app uses, and this is the native
 * view inside it: SwiftUI's `BottomSheetView` on iOS, Compose's `ModalBottomSheetView` on Android.
 * It has an element name of its own because `ui-bottom-sheet` is that component's, and a
 * component's template takes its own selector to be the component again.
 *
 * The two views share no prop. An input left unset never reaches native, so the component sets
 * the ones the platform reads. The events are outputs for their type only, as with the other
 * `@expo/ui` components: the element's own event is what arrives.
 */
import { Component, ElementRef, inject, input, output } from '@angular/core';
import { type NativeSyntheticEvent, keepNativeView } from '@ng-native/fabric';

/** How Compose's sheet may be dismissed other than by a swipe, as `@expo/ui` names it. */
export interface UiModalBottomSheetProperties {
  readonly shouldDismissOnBackPress?: boolean;
  readonly shouldDismissOnClickOutside?: boolean;
}

/** What SwiftUI's sheet sends when the user dismisses it: that it is no longer presented. */
export type UiBottomSheetPresentedEvent = NativeSyntheticEvent<{ readonly isPresented: boolean }>;

@Component({
  selector: 'ui-bottom-sheet-view',
  template: '<ng-content />',
  host: {
    '[isPresented]': 'isPresented()',
    '[fitToContents]': 'fitToContents()',
    '[showDragHandle]': 'showDragHandle()',
    '[containerColor]': 'containerColor()',
    '[skipPartiallyExpanded]': 'skipPartiallyExpanded()',
    '[sheetGesturesEnabled]': 'sheetGesturesEnabled()',
    '[properties]': 'properties()',
  },
})
export class UiBottomSheetView {
  /** SwiftUI: whether the sheet is presented. The view stays in the tree either way. */
  readonly isPresented = input<boolean>();
  /** SwiftUI: the sheet's one detent is the height of its content. */
  readonly fitToContents = input<boolean>();
  /** Compose: whether the drag handle is drawn. */
  readonly showDragHandle = input<boolean>();
  /** Compose: the sheet's colour behind its content. A colour prop, so the engine converts it. */
  readonly containerColor = input<unknown>();
  /** Compose: the sheet opens at its full height rather than resting at half the screen's. */
  readonly skipPartiallyExpanded = input<boolean>();
  /** Compose: whether the sheet can be dragged, between its heights and down to dismiss it. */
  readonly sheetGesturesEnabled = input<boolean>();
  /** Compose: whether the back button and a tap outside the sheet dismiss it. */
  readonly properties = input<UiModalBottomSheetProperties>();
  /** SwiftUI: the user dismissed the sheet, or it was presented by something other than the prop. */
  readonly isPresentedChange = output<UiBottomSheetPresentedEvent>();
  /** SwiftUI: the sheet has finished dismissing, whoever dismissed it. */
  readonly dismiss = output<NativeSyntheticEvent<Record<string, never>>>();
  /** Compose: the user dismissed the sheet, which stays until it leaves the tree. */
  readonly dismissRequest = output<NativeSyntheticEvent<Record<string, never>>>();

  constructor() {
    // The host is the registered native view, not a plain one: see `keepNativeView`.
    keepNativeView(inject(ElementRef).nativeElement);
  }
}
