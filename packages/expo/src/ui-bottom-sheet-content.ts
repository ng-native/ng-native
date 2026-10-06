/**
 * `<ui-bottom-sheet-content>`: the one view a sheet's `ui-view-host` holds, with the sheet's
 * content inside it.
 *
 * A part of `UiBottomSheet` in `expo-ui-components.ts`. The wrapping around a sheet's content
 * differs by platform, so that component's template writes it twice, and content written to more
 * than one `<ng-content>` is only ever in the last. So the content is written to one template
 * there and stamped here, which is `NgTemplateOutlet` without depending on `@angular/common`.
 */
import {
  type AfterViewInit,
  Component,
  type TemplateRef,
  ViewContainerRef,
  input,
  viewChild,
} from '@angular/core';

@Component({
  selector: 'ui-bottom-sheet-content',
  template: '<ng-container #outlet />',
})
export class UiBottomSheetContent implements AfterViewInit {
  readonly content = input.required<TemplateRef<unknown>>();

  private readonly outlet = viewChild.required('outlet', { read: ViewContainerRef });

  ngAfterViewInit(): void {
    this.outlet().createEmbeddedView(this.content());
  }
}
